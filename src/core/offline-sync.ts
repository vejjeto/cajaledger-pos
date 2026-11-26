import type { CreateSaleInput, StockConflictItem } from "@/contracts/schemas";
import type { OfflineQueueStore, PendingSaleRecord } from "./offline-db";

export interface SyncTransportResult {
  ok: boolean;
  status: number;
  conflictMessage?: string;
  conflictDetails?: StockConflictItem[];
}

export type SyncSaleTransport = (
  payload: CreateSaleInput,
) => Promise<SyncTransportResult>;

export interface SyncQueueSummary {
  syncedCount: number;
  conflictCount: number;
  remainingPendingCount: number;
  stoppedOnNetworkError: boolean;
}

export async function defaultFetchSaleTransport(
  payload: CreateSaleInput,
): Promise<SyncTransportResult> {
  const res = await fetch("/api/sales", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    return { ok: true, status: res.status };
  }

  let message = `HTTP ${res.status}`;
  let details: StockConflictItem[] | undefined;
  try {
    const body = (await res.json()) as {
      detail?: string;
      error?: string;
      errors?: StockConflictItem[];
      details?: StockConflictItem[];
    };
    if (body.detail) message = body.detail;
    else if (body.error) message = body.error;
    if (Array.isArray(body.errors)) details = body.errors;
    else if (Array.isArray(body.details)) details = body.details;
  } catch {
    // Non-JSON error body
  }

  return {
    ok: false,
    status: res.status,
    conflictMessage: message,
    ...(details !== undefined ? { conflictDetails: details } : {}),
  };
}

export async function syncPendingSales(
  store: OfflineQueueStore,
  transport: SyncSaleTransport = defaultFetchSaleTransport,
): Promise<SyncQueueSummary> {
  const queue = await store.listPending();
  let syncedCount = 0;
  let conflictCount = 0;
  let stoppedOnNetworkError = false;

  for (const record of queue) {
    if (record.status === "conflict") {
      conflictCount += 1;
      continue;
    }

    await store.updateRecord(record.id, {
      status: "syncing",
      attempts: record.attempts + 1,
    });

    const payload: CreateSaleInput = {
      idempotencyKey: record.idempotencyKey,
      paymentMethod: record.paymentMethod,
      taxBps: record.taxBps,
      createdOfflineAt: record.createdOfflineAt,
      items: record.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      })),
    };

    try {
      const result = await transport(payload);
      if (result.ok) {
        await store.remove(record.id);
        syncedCount += 1;
      } else if (result.status === 409) {
        await store.updateRecord(record.id, {
          status: "conflict",
          conflictMessage:
            result.conflictMessage ?? "Stock insuficiente al sincronizar",
          conflictDetails: result.conflictDetails ?? [],
        });
        conflictCount += 1;
      } else {
        await store.updateRecord(record.id, { status: "pending" });
        stoppedOnNetworkError = true;
        break;
      }
    } catch {
      await store.updateRecord(record.id, { status: "pending" });
      stoppedOnNetworkError = true;
      break;
    }
  }

  const remaining = await store.listPending();
  const remainingPendingCount = remaining.filter(
    (item) => item.status === "pending",
  ).length;

  return {
    syncedCount,
    conflictCount,
    remainingPendingCount,
    stoppedOnNetworkError,
  };
}

export async function adjustConflictedSaleToAvailable(
  store: OfflineQueueStore,
  record: PendingSaleRecord,
): Promise<PendingSaleRecord | null> {
  const availableMap = new Map(
    (record.conflictDetails ?? []).map((d) => [d.productId, d.available]),
  );

  const adjustedItems = record.items
    .map((item) => {
      const avail = availableMap.get(item.productId);
      if (avail === undefined) return item;
      const nextQty = Math.min(item.quantity, avail);
      return { ...item, quantity: nextQty };
    })
    .filter((item) => item.quantity > 0);

  if (adjustedItems.length === 0) {
    await store.remove(record.id);
    return null;
  }

  const subtotal = adjustedItems.reduce(
    (acc, item) => acc + item.unitPriceCents * item.quantity,
    0,
  );
  const tax = Math.round((subtotal * record.taxBps) / 10000);
  const { conflictMessage: _cm, conflictDetails: _cd, ...rest } = record;
  const updated: PendingSaleRecord = {
    ...rest,
    items: adjustedItems,
    totalCents: subtotal + tax,
    status: "pending",
  };

  await store.enqueue(updated);
  return updated;
}
