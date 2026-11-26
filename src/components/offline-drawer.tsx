"use client";

import { UiButton } from "@/components/ui/button";
import { UiModal } from "@/components/ui/modal";
import { useUiToast } from "@/components/ui/toast";
import { formatCents } from "@/core/money";
import type { OfflineQueueStore, PendingSaleRecord } from "@/core/offline-db";
import { adjustConflictedSaleToAvailable } from "@/core/offline-sync";
import { AlertTriangle, RefreshCw, Trash2, Wrench } from "lucide-react";
import * as React from "react";

interface OfflineDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingSales: PendingSaleRecord[];
  isOffline: boolean;
  syncing: boolean;
  offlineStore: OfflineQueueStore;
  onSyncNow: () => Promise<void>;
  onRefreshPending: () => Promise<void>;
}

export function OfflineDrawer({
  open,
  onOpenChange,
  pendingSales,
  isOffline,
  syncing,
  offlineStore,
  onSyncNow,
  onRefreshPending,
}: OfflineDrawerProps) {
  const { pushToast } = useUiToast();

  const handleAdjust = async (record: PendingSaleRecord) => {
    const adjusted = await adjustConflictedSaleToAvailable(
      offlineStore,
      record,
    );
    await onRefreshPending();
    if (!adjusted) {
      pushToast({
        title: "Venta removida (sin stock disponible)",
        variant: "info",
      });
      return;
    }
    pushToast({
      title: "Cantidades ajustadas al stock real",
      description: isOffline
        ? "Lista para sincronizar al volver la red"
        : "Sincronizando ahora...",
      variant: "success",
    });
    if (!isOffline) {
      await onSyncNow();
    }
  };

  const handleCancel = async (id: string) => {
    await offlineStore.remove(id);
    await onRefreshPending();
    pushToast({ title: "Venta offline cancelada", variant: "info" });
  };

  return (
    <UiModal
      open={open}
      onOpenChange={onOpenChange}
      title="Cola Offline & Resolución de Conflictos"
      description="Ventas almacenadas en IndexedDB (Dexie.js) pendientes de sincronización FIFO"
      className="max-w-2xl"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900">
          <span>
            Estado de red:{" "}
            <strong
              className={isOffline ? "text-amber-500" : "text-emerald-500"}
            >
              {isOffline ? "OFFLINE (cola retenida)" : "ONLINE"}
            </strong>
          </span>
          <UiButton
            size="sm"
            loading={syncing}
            disabled={isOffline || pendingSales.length === 0}
            onClick={() => void onSyncNow()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Sincronizar FIFO ({pendingSales.length})
          </UiButton>
        </div>

        {pendingSales.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 py-8 text-center text-xs text-zinc-500 dark:border-zinc-800">
            No hay ventas pendientes ni conflictos en IndexedDB.
          </p>
        ) : (
          <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
            {pendingSales.map((sale) => (
              <div
                key={sale.id}
                className={`rounded-xl border p-3 text-xs ${
                  sale.status === "conflict"
                    ? "border-rose-500/40 bg-rose-500/5"
                    : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/70"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          sale.status === "conflict"
                            ? "bg-rose-500/20 text-rose-400"
                            : "bg-amber-500/20 text-amber-400"
                        }`}
                      >
                        {sale.status}
                      </span>
                      <span className="font-mono text-[11px] text-zinc-500">
                        {sale.createdOfflineAt.slice(11, 19)} ·{" "}
                        {sale.paymentMethod}
                      </span>
                    </div>
                    <p className="mt-1.5 font-medium">
                      {sale.items
                        .map((i) => `${i.quantity}× ${i.productName}`)
                        .join(", ")}
                    </p>
                  </div>
                  <span className="font-mono text-sm font-bold">
                    {formatCents(sale.totalCents)}
                  </span>
                </div>

                {sale.status === "conflict" && (
                  <div className="mt-2.5 space-y-2 rounded-lg border border-rose-500/30 bg-rose-950/20 p-2.5">
                    <p className="flex items-center gap-1.5 font-semibold text-rose-400">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {sale.conflictMessage ??
                        "Conflicto 409 INSUFFICIENT_STOCK"}
                    </p>
                    {sale.conflictDetails?.map((d) => (
                      <p
                        key={d.productId}
                        className="text-[11px] text-zinc-400"
                      >
                        • {d.productName}: solicitado {d.requested}, disponible
                        real {d.available}
                      </p>
                    ))}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <UiButton
                        size="sm"
                        onClick={() => void handleAdjust(sale)}
                      >
                        <Wrench className="h-3.5 w-3.5" />
                        Ajustar al stock disponible
                      </UiButton>
                      <UiButton
                        size="sm"
                        variant="danger"
                        onClick={() => void handleCancel(sale.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Cancelar venta
                      </UiButton>
                    </div>
                  </div>
                )}

                {sale.status !== "conflict" && (
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleCancel(sale.id)}
                      className="text-[11px] text-zinc-500 hover:text-rose-500"
                    >
                      Descartar de cola
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </UiModal>
  );
}
