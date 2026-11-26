import { randomUUID } from "node:crypto";
import { GET as getHealthRoute } from "@/app/api/health/route";
import { DELETE as deleteSaleRoute } from "@/app/api/sales/[id]/route";
import {
  buildCsv,
  buildInventoryCsv,
  buildLedgerCsv,
  escapeCsvCell,
} from "@/core/csv";
import {
  calculateGrossMarginPercent,
  calculateSaleTotals,
  calculateTaxCents,
  formatCents,
} from "@/core/money";
import { MemoryOfflineStore } from "@/core/offline-db";
import {
  adjustConflictedSaleToAvailable,
  syncPendingSales,
} from "@/core/offline-sync";
import { buildMinimalPdfReceipt, generateReceiptPdfBuffer } from "@/core/pdf";
import {
  SaleServiceError,
  createProduct,
  createSale,
  getAnalytics,
  listProducts,
  restockProduct,
  voidSale,
} from "@/core/sales-service";
import { createDatabase } from "@/db";
import { seedDatabase } from "@/db/seed";
import { parseEnv } from "@/lib/env";
import { buildCajaLedgerOpenApiSpec } from "@/lib/openapi";
import { describe, expect, it } from "vitest";

function setupInMemoryDb() {
  return createDatabase(":memory:");
}

describe("CajaLedger — Golden Monetary Rule (Integer Cents)", () => {
  it("computes tax in basis points and totals strictly in integer cents without float drift", () => {
    // Classic JS float trap: 0.1 + 0.2 !== 0.3, and 19.99 * 3 = 59.97
    const tax = calculateTaxCents(1999 * 3, 1600);
    expect(Number.isInteger(tax)).toBe(true);
    expect(tax).toBe(Math.round((5997 * 1600) / 10000)); // 960 cents

    const totals = calculateSaleTotals(
      [
        { quantity: 3, unitPriceCents: 1999, unitCostCents: 1000 },
        { quantity: 2, unitPriceCents: 2500, unitCostCents: 1200 },
      ],
      1600,
    );

    expect(totals.subtotalCents).toBe(10997);
    expect(totals.taxCents).toBe(1760);
    expect(totals.totalCents).toBe(12757);
    expect(totals.totalCostCents).toBe(5400);
    expect(totals.profitCents).toBe(5597);
    expect(totals.grossMarginPercent).toBe(50.9);
    expect(formatCents(totals.totalCents)).toContain("127.57");
  });

  it("returns 0% gross margin safely when revenue is zero", () => {
    expect(calculateGrossMarginPercent(0, 0)).toBe(0);
    expect(() => calculateTaxCents(100.5 as number)).toThrow(RangeError);
  });
});

describe("CajaLedger — ACID Transactions, Rollback & Idempotency", () => {
  it("seeds 15 realistic products and 14 days of sales idempotently", async () => {
    const ctx = setupInMemoryDb();
    const first = await seedDatabase(ctx);
    const second = await seedDatabase(ctx);

    expect(first.productsSeeded).toBe(15);
    expect(first.salesSeeded).toBeGreaterThanOrEqual(28);
    expect(second.productsSeeded).toBe(0);

    const prods = await listProducts(ctx);
    expect(prods).toHaveLength(15);
  });

  it("prevents duplicate charges via idempotencyKey replay returning original sale", async () => {
    const ctx = setupInMemoryDb();
    await seedDatabase(ctx);
    const prods = await listProducts(ctx);
    const p1 = prods[0]!;
    const initialStock = p1.stock;
    const key = randomUUID();

    const first = await createSale(ctx, {
      idempotencyKey: key,
      paymentMethod: "card",
      items: [{ productId: p1.id, quantity: 2 }],
    });
    expect(first.idempotentReplay).toBe(false);

    const replay = await createSale(ctx, {
      idempotencyKey: key,
      paymentMethod: "card",
      items: [{ productId: p1.id, quantity: 2 }],
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.sale.id).toBe(first.sale.id);
    expect(replay.sale.receiptNumber).toBe(first.sale.receiptNumber);

    const after = (await listProducts(ctx)).find((p) => p.id === p1.id)!;
    expect(after.stock).toBe(initialStock - 2);
  });

  it("rolls back the entire sale atomically on insufficient stock with zero partial mutations", async () => {
    const ctx = setupInMemoryDb();
    await seedDatabase(ctx);
    const prods = await listProducts(ctx);
    const okProduct = prods.find((p) => p.stock >= 10)!;
    const lowProduct = prods.find((p) => p.stock <= 5)!;

    const beforeAnalytics = await getAnalytics(ctx);
    const beforeSalesCount = beforeAnalytics.salesCount;
    const beforeLedgerCount = beforeAnalytics.ledger.length;

    await expect(
      createSale(ctx, {
        idempotencyKey: randomUUID(),
        paymentMethod: "cash",
        items: [
          { productId: okProduct.id, quantity: 3 },
          { productId: lowProduct.id, quantity: lowProduct.stock + 50 },
        ],
      }),
    ).rejects.toMatchObject({
      name: "SaleServiceError",
      code: "INSUFFICIENT_STOCK",
      statusCode: 409,
    });

    const afterProds = await listProducts(ctx);
    const okAfter = afterProds.find((p) => p.id === okProduct.id)!;
    const lowAfter = afterProds.find((p) => p.id === lowProduct.id)!;
    expect(okAfter.stock).toBe(okProduct.stock);
    expect(lowAfter.stock).toBe(lowProduct.stock);

    const afterAnalytics = await getAnalytics(ctx);
    expect(afterAnalytics.salesCount).toBe(beforeSalesCount);
    expect(afterAnalytics.ledger.length).toBe(beforeLedgerCount);
  });

  it("aggregates duplicate productIds in one sale before checking stock", async () => {
    const ctx = setupInMemoryDb();
    await seedDatabase(ctx);
    const prods = await listProducts(ctx);
    const target = prods.find((p) => p.stock > 0 && p.stock <= 5)!;

    await expect(
      createSale(ctx, {
        idempotencyKey: randomUUID(),
        paymentMethod: "transfer",
        items: [
          { productId: target.id, quantity: target.stock },
          { productId: target.id, quantity: 1 },
        ],
      }),
    ).rejects.toBeInstanceOf(SaleServiceError);
  });

  it("restocks inventory atomically and records a ledger expense entry", async () => {
    const ctx = setupInMemoryDb();
    await seedDatabase(ctx);
    const prods = await listProducts(ctx);
    const target = prods[0]!;
    const beforeStock = target.stock;

    const updated = await restockProduct(ctx, target.id, {
      quantity: 5,
      note: "Factura #991",
      recordExpense: true,
    });

    expect(updated.stock).toBe(beforeStock + 5);
    const analytics = await getAnalytics(ctx);
    expect(analytics.ledger[0]?.type).toBe("expense");
    expect(analytics.ledger[0]?.amountCents).toBe(target.costCents * 5);
  });

  it("handles concurrent 2-sale race condition on the last 1 unit in stock (1 succeeds, 1 rejects 409, stock = 0)", async () => {
    const ctx = setupInMemoryDb();
    const scarce = await createProduct(ctx, {
      sku: "RACE-LAST-1",
      name: "Última Unidad",
      category: "Test",
      costCents: 1000,
      priceCents: 2000,
      stock: 1,
      minStock: 1,
    });

    const [r1, r2] = await Promise.allSettled([
      createSale(ctx, {
        idempotencyKey: randomUUID(),
        paymentMethod: "cash",
        items: [{ productId: scarce.id, quantity: 1 }],
      }),
      createSale(ctx, {
        idempotencyKey: randomUUID(),
        paymentMethod: "card",
        items: [{ productId: scarce.id, quantity: 1 }],
      }),
    ]);

    const fulfilled = [r1, r2].filter((r) => r.status === "fulfilled");
    const rejected = [r1, r2].filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      name: "SaleServiceError",
      code: "INSUFFICIENT_STOCK",
      statusCode: 409,
    });

    const after = (await listProducts(ctx)).find((p) => p.id === scarce.id)!;
    expect(after.stock).toBe(0);
  });

  it("voids a sale atomically via append-only counter-entry, restores stock, and blocks double-void", async () => {
    const ctx = setupInMemoryDb();
    await seedDatabase(ctx);
    const prods = await listProducts(ctx);
    const target = prods[0]!;
    const initialStock = target.stock;

    const created = await createSale(ctx, {
      idempotencyKey: randomUUID(),
      paymentMethod: "cash",
      items: [{ productId: target.id, quantity: 3 }],
    });

    const afterSaleStock = (await listProducts(ctx)).find(
      (p) => p.id === target.id,
    )!.stock;
    expect(afterSaleStock).toBe(initialStock - 3);

    const voided = await voidSale(
      ctx,
      created.sale.id,
      "Cliente devolvió producto",
    );
    expect(voided.sale.status).toBe("voided");
    expect(voided.sale.voidReason).toBe("Cliente devolvió producto");
    expect(voided.restoredItems).toBe(3);
    expect(voided.ledgerEntry.type).toBe("expense");
    expect(voided.ledgerEntry.category).toBe("devolucion");
    expect(voided.ledgerEntry.amountCents).toBe(created.sale.totalCents);
    expect(voided.ledgerEntry.referenceId).toBe(created.sale.id);

    const afterVoidStock = (await listProducts(ctx)).find(
      (p) => p.id === target.id,
    )!.stock;
    expect(afterVoidStock).toBe(initialStock);

    await expect(
      voidSale(ctx, created.sale.id, "Segundo intento"),
    ).rejects.toMatchObject({
      name: "SaleServiceError",
      code: "ALREADY_VOIDED",
      statusCode: 409,
    });
  });

  it("rejects DELETE /api/sales/[id] with 405 Method Not Allowed RFC 7807 Problem Details", async () => {
    const req = new Request("http://localhost:3009/api/sales/sale-123", {
      method: "DELETE",
      headers: { "x-request-id": "req-test-405" },
    });
    const res = await deleteSaleRoute(req, {
      params: Promise.resolve({ id: "sale-123" }),
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(res.headers.get("x-request-id")).toBe("req-test-405");
    const body = (await res.json()) as {
      status: number;
      code: string;
      detail: string;
    };
    expect(body.status).toBe(405);
    expect(body.code).toBe("IMMUTABLE_LEDGER");
  });
});

describe("CajaLedger — Offline-First FIFO Queue & 409 Conflict Resolution", () => {
  it("syncs queued offline sales in strict FIFO order and marks 409 conflicts", async () => {
    const store = new MemoryOfflineStore();
    await store.enqueue({
      id: "off-2",
      idempotencyKey: randomUUID(),
      paymentMethod: "card",
      taxBps: 1600,
      createdOfflineAt: "2026-11-25T10:05:00.000Z",
      totalCents: 58000,
      status: "pending",
      attempts: 0,
      items: [
        {
          productId: "prod-02",
          productName: "Hub",
          quantity: 1,
          unitPriceCents: 50000,
        },
      ],
    });
    await store.enqueue({
      id: "off-1",
      idempotencyKey: randomUUID(),
      paymentMethod: "cash",
      taxBps: 1600,
      createdOfflineAt: "2026-11-25T10:01:00.000Z",
      totalCents: 116000,
      status: "pending",
      attempts: 0,
      items: [
        {
          productId: "prod-15",
          productName: "Funda",
          quantity: 4,
          unitPriceCents: 25000,
        },
      ],
    });

    const callOrder: string[] = [];
    const summary = await syncPendingSales(store, async (payload) => {
      callOrder.push(payload.createdOfflineAt ?? "");
      if (payload.items[0]?.productId === "prod-15") {
        return {
          ok: false,
          status: 409,
          conflictMessage: "Stock insuficiente",
          conflictDetails: [
            {
              productId: "prod-15",
              productName: "Funda",
              requested: 4,
              available: 2,
            },
          ],
        };
      }
      return { ok: true, status: 201 };
    });

    expect(callOrder).toEqual([
      "2026-11-25T10:01:00.000Z",
      "2026-11-25T10:05:00.000Z",
    ]);
    expect(summary.syncedCount).toBe(1);
    expect(summary.conflictCount).toBe(1);

    const remaining = await store.listPending();
    expect(remaining).toHaveLength(1);
    const firstConflict = remaining[0]!;
    expect(firstConflict.status).toBe("conflict");

    const adjusted = await adjustConflictedSaleToAvailable(
      store,
      firstConflict,
    );
    expect(adjusted).not.toBeNull();
    expect(adjusted?.status).toBe("pending");
    expect(adjusted?.items[0]?.quantity).toBe(2);
    expect(adjusted?.totalCents).toBe(58000);
  });
});

describe("CajaLedger — Exports (CSV, PDF) & Observability Contracts", () => {
  it("escapes RFC 4180 CSV cells and builds inventory & ledger exports", () => {
    expect(escapeCsvCell('Funda "Pro", 14"')).toBe('"Funda ""Pro"", 14"""');
    const csv = buildCsv(["col1", "col2"], [["a,b", "line1\nline2"]]);
    expect(csv).toBe('col1,col2\r\n"a,b","line1\nline2"\r\n');

    const invCsv = buildInventoryCsv([
      {
        id: "p1",
        sku: "SKU-1",
        name: 'Cable "100W", 2m',
        category: "Cables",
        costCents: 6500,
        priceCents: 18900,
        stock: 10,
        minStock: 3,
        isActive: true,
        updatedAt: "2026-11-25T12:00:00.000Z",
      },
    ]);
    expect(invCsv).toContain('"Cable ""100W"", 2m"');

    const ledgerCsv = buildLedgerCsv([
      {
        id: "l1",
        type: "income",
        category: "venta_pos",
        amountCents: 18900,
        description: "Venta CL-100",
        referenceId: "s1",
        createdAt: "2026-11-25T12:00:00.000Z",
      },
    ]);
    expect(ledgerCsv).toContain("venta_pos,18900");
  });

  it("generates valid %PDF- receipt buffers (react-pdf + deterministic fallback)", async () => {
    const sampleSale = {
      id: "sale-pdf-1",
      idempotencyKey: randomUUID(),
      receiptNumber: "CL-2026-9999",
      paymentMethod: "cash" as const,
      status: "completed" as const,
      subtotalCents: 10000,
      taxCents: 1600,
      totalCents: 11600,
      profitCents: 4000,
      createdOfflineAt: null,
      voidedAt: null,
      voidReason: null,
      createdAt: "2026-11-25T12:00:00.000Z",
    };
    const sampleItems = [
      {
        id: "si-1",
        saleId: "sale-pdf-1",
        productId: "prod-01",
        productName: "Cargador GaN 65W",
        sku: "TECH-USB-C65",
        quantity: 1,
        unitPriceCents: 10000,
        unitCostCents: 6000,
      },
    ];

    const fallbackBytes = buildMinimalPdfReceipt(sampleSale, sampleItems);
    expect(Buffer.from(fallbackBytes.subarray(0, 5)).toString("ascii")).toBe(
      "%PDF-",
    );

    const renderedBytes = await generateReceiptPdfBuffer(
      sampleSale,
      sampleItems,
    );
    expect(Buffer.from(renderedBytes.subarray(0, 5)).toString("ascii")).toBe(
      "%PDF-",
    );
  });

  it("validates env fail-fast, serves /api/health, and builds OpenAPI 3.1.0 specification", async () => {
    expect(() =>
      parseEnv({ NEXT_PUBLIC_APP_URL: "not-a-url" }, { forceValidate: true }),
    ).toThrow(/Invalid environment configuration/);

    const skipped = parseEnv({
      SKIP_ENV_VALIDATION: "true",
      NEXT_PUBLIC_APP_URL: "not-a-url",
    });
    expect(skipped.DATABASE_URL).toBe("file:./data/cajaledger.db");

    const res = await getHealthRoute(
      new Request("http://localhost:3009/api/health"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    const healthBody = (await res.json()) as {
      status: string;
      service: string;
    };
    expect(healthBody.status).toBe("ok");
    expect(healthBody.service).toBe("cajaledger-pos");

    const spec = buildCajaLedgerOpenApiSpec("http://localhost:3009");
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths as Record<string, unknown>)).toContain(
      "/api/sales",
    );
    expect(Object.keys(spec.paths as Record<string, unknown>)).toContain(
      "/api/sales/{id}/void",
    );
  });
});
