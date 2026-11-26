import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

const writeQueues = new WeakMap<DatabaseSync, Promise<unknown>>();

// Serialize BEGIN IMMEDIATE blocks per DatabaseSync connection because drizzle-proxy
// awaits microtasks between statements on Node's single-threaded event loop.
function withWriteLock<T>(
  sqlite: DatabaseSync,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = writeQueues.get(sqlite) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  writeQueues.set(sqlite, next);
  return next;
}
import type {
  CreateProductInput,
  CreateSaleInput,
  CreateSaleResult,
  LedgerEntryRecord,
  ProductRecord,
  RestockProductInput,
  SaleItemDetail,
  SaleRecord,
  StockConflictItem,
} from "@/contracts/schemas";
import type { DatabaseContext } from "@/db";
import {
  inventoryMovements,
  ledgerEntries,
  products,
  saleItems,
  sales,
} from "@/db/schema";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  DEFAULT_TAX_BPS,
  calculateGrossMarginPercent,
  calculateSaleTotals,
} from "./money";

export class SaleServiceError extends Error {
  readonly code:
    | "INSUFFICIENT_STOCK"
    | "PRODUCT_NOT_FOUND"
    | "DUPLICATE_SKU"
    | "INVALID_STATE"
    | "SALE_NOT_FOUND"
    | "ALREADY_VOIDED";
  readonly statusCode: number;
  readonly details?: StockConflictItem[] | undefined;

  constructor(
    code:
      | "INSUFFICIENT_STOCK"
      | "PRODUCT_NOT_FOUND"
      | "DUPLICATE_SKU"
      | "INVALID_STATE"
      | "SALE_NOT_FOUND"
      | "ALREADY_VOIDED",
    statusCode: number,
    message: string,
    details?: StockConflictItem[],
  ) {
    super(message);
    this.name = "SaleServiceError";
    this.code = code;
    this.statusCode = statusCode;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

function aggregateItems(items: CreateSaleInput["items"]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity);
  }
  return map;
}

function generateReceiptNumber(): string {
  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  const rand = randomUUID().slice(0, 4).toUpperCase();
  return `CL-${stamp}-${rand}`;
}

async function fetchSaleItemsWithProduct(
  ctx: DatabaseContext,
  saleId: string,
): Promise<SaleItemDetail[]> {
  const rows = await ctx.db
    .select({
      id: saleItems.id,
      saleId: saleItems.saleId,
      productId: saleItems.productId,
      productName: products.name,
      sku: products.sku,
      quantity: saleItems.quantity,
      unitPriceCents: saleItems.unitPriceCents,
      unitCostCents: saleItems.unitCostCents,
    })
    .from(saleItems)
    .innerJoin(products, eq(saleItems.productId, products.id))
    .where(eq(saleItems.saleId, saleId));

  return rows;
}

export async function createSale(
  ctx: DatabaseContext,
  input: CreateSaleInput,
): Promise<CreateSaleResult> {
  const [existing] = await ctx.db
    .select()
    .from(sales)
    .where(eq(sales.idempotencyKey, input.idempotencyKey))
    .limit(1);

  if (existing) {
    const items = await fetchSaleItemsWithProduct(ctx, existing.id);
    return { sale: existing, items, idempotentReplay: true };
  }

  const aggregated = aggregateItems(input.items);
  const productIds = Array.from(aggregated.keys());
  const taxBps = input.taxBps ?? DEFAULT_TAX_BPS;

  return withWriteLock(ctx.sqlite, async () => {
    ctx.sqlite.exec("BEGIN IMMEDIATE TRANSACTION");
    try {
      // Re-check idempotency inside the IMMEDIATE write lock to avoid race duplicates.
      const [raceExisting] = await ctx.db
        .select()
        .from(sales)
        .where(eq(sales.idempotencyKey, input.idempotencyKey))
        .limit(1);

      if (raceExisting) {
        ctx.sqlite.exec("ROLLBACK");
        const items = await fetchSaleItemsWithProduct(ctx, raceExisting.id);
        return { sale: raceExisting, items, idempotentReplay: true };
      }

      const dbProducts = await ctx.db
        .select()
        .from(products)
        .where(inArray(products.id, productIds));

      const byId = new Map(dbProducts.map((p) => [p.id, p]));
      const conflicts: StockConflictItem[] = [];

      for (const [productId, requested] of aggregated.entries()) {
        const prod = byId.get(productId);
        if (!prod || !prod.isActive) {
          throw new SaleServiceError(
            "PRODUCT_NOT_FOUND",
            404,
            `Producto no encontrado o inactivo: ${productId}`,
          );
        }
        if (prod.stock < requested) {
          conflicts.push({
            productId: prod.id,
            productName: prod.name,
            requested,
            available: prod.stock,
          });
        }
      }

      if (conflicts.length > 0) {
        throw new SaleServiceError(
          "INSUFFICIENT_STOCK",
          409,
          `Stock insuficiente para ${conflicts.map((c) => c.productName).join(", ")}`,
          conflicts,
        );
      }

      const pricedLines = Array.from(aggregated.entries()).map(
        ([productId, quantity]) => {
          const prod = byId.get(productId)!;
          return {
            product: prod,
            quantity,
            unitPriceCents: prod.priceCents,
            unitCostCents: prod.costCents,
          };
        },
      );

      const totals = calculateSaleTotals(pricedLines, taxBps);
      const nowIso = new Date().toISOString();
      const saleRecord: SaleRecord = {
        id: randomUUID(),
        idempotencyKey: input.idempotencyKey,
        receiptNumber: generateReceiptNumber(),
        paymentMethod: input.paymentMethod,
        status: "completed",
        subtotalCents: totals.subtotalCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        profitCents: totals.profitCents,
        createdOfflineAt: input.createdOfflineAt ?? null,
        voidedAt: null,
        voidReason: null,
        createdAt: nowIso,
      };

      await ctx.db.insert(sales).values(saleRecord);

      const insertedItems: SaleItemDetail[] = [];
      for (const line of pricedLines) {
        const itemId = randomUUID();
        await ctx.db.insert(saleItems).values({
          id: itemId,
          saleId: saleRecord.id,
          productId: line.product.id,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          unitCostCents: line.unitCostCents,
        });

        await ctx.db
          .update(products)
          .set({
            stock: sql`${products.stock} - ${line.quantity}`,
            updatedAt: nowIso,
          })
          .where(eq(products.id, line.product.id));

        await ctx.db.insert(inventoryMovements).values({
          id: randomUUID(),
          productId: line.product.id,
          delta: -line.quantity,
          reason: "sale",
          referenceId: saleRecord.id,
          createdAt: nowIso,
        });

        insertedItems.push({
          id: itemId,
          saleId: saleRecord.id,
          productId: line.product.id,
          productName: line.product.name,
          sku: line.product.sku,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          unitCostCents: line.unitCostCents,
        });
      }

      await ctx.db.insert(ledgerEntries).values({
        id: randomUUID(),
        type: "income",
        category: "venta_pos",
        amountCents: totals.totalCents,
        description: `Venta POS ${saleRecord.receiptNumber} (${input.paymentMethod})`,
        referenceId: saleRecord.id,
        createdAt: nowIso,
      });

      ctx.sqlite.exec("COMMIT");
      return {
        sale: saleRecord,
        items: insertedItems,
        idempotentReplay: false,
      };
    } catch (err) {
      try {
        ctx.sqlite.exec("ROLLBACK");
      } catch {
        // Already rolled back
      }
      throw err;
    }
  });
}

export async function listProducts(
  ctx: DatabaseContext,
): Promise<ProductRecord[]> {
  return ctx.db
    .select()
    .from(products)
    .where(eq(products.isActive, true))
    .orderBy(asc(products.name));
}

export async function createProduct(
  ctx: DatabaseContext,
  input: CreateProductInput,
): Promise<ProductRecord> {
  const [dup] = await ctx.db
    .select()
    .from(products)
    .where(eq(products.sku, input.sku))
    .limit(1);

  if (dup) {
    throw new SaleServiceError(
      "DUPLICATE_SKU",
      409,
      `El SKU ${input.sku} ya existe`,
    );
  }

  const nowIso = new Date().toISOString();
  const record: ProductRecord = {
    id: randomUUID(),
    sku: input.sku,
    name: input.name,
    category: input.category,
    costCents: input.costCents,
    priceCents: input.priceCents,
    stock: input.stock,
    minStock: input.minStock,
    isActive: true,
    updatedAt: nowIso,
  };

  ctx.sqlite.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    await ctx.db.insert(products).values(record);
    if (record.stock > 0) {
      await ctx.db.insert(inventoryMovements).values({
        id: randomUUID(),
        productId: record.id,
        delta: record.stock,
        reason: "restock",
        referenceId: "ALTA-INICIAL",
        createdAt: nowIso,
      });
    }
    ctx.sqlite.exec("COMMIT");
    return record;
  } catch (err) {
    ctx.sqlite.exec("ROLLBACK");
    throw err;
  }
}

export async function restockProduct(
  ctx: DatabaseContext,
  productId: string,
  input: RestockProductInput,
): Promise<ProductRecord> {
  const nowIso = new Date().toISOString();
  ctx.sqlite.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    const [existing] = await ctx.db
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    if (!existing) {
      throw new SaleServiceError(
        "PRODUCT_NOT_FOUND",
        404,
        `Producto no encontrado: ${productId}`,
      );
    }

    const updatedStock = existing.stock + input.quantity;
    await ctx.db
      .update(products)
      .set({ stock: updatedStock, updatedAt: nowIso })
      .where(eq(products.id, productId));

    const refId = `RESTOCK-${Date.now().toString(36).toUpperCase()}`;
    await ctx.db.insert(inventoryMovements).values({
      id: randomUUID(),
      productId,
      delta: input.quantity,
      reason: "restock",
      referenceId: refId,
      createdAt: nowIso,
    });

    const expenseCents = existing.costCents * input.quantity;
    if (input.recordExpense && expenseCents > 0) {
      await ctx.db.insert(ledgerEntries).values({
        id: randomUUID(),
        type: "expense",
        category: "reabastecimiento",
        amountCents: expenseCents,
        description: input.note
          ? `Reabastecimiento ${existing.name} (+${input.quantity}): ${input.note}`
          : `Reabastecimiento ${existing.name} (+${input.quantity} uds)`,
        referenceId: refId,
        createdAt: nowIso,
      });
    }

    ctx.sqlite.exec("COMMIT");
    return { ...existing, stock: updatedStock, updatedAt: nowIso };
  } catch (err) {
    try {
      ctx.sqlite.exec("ROLLBACK");
    } catch {
      // Already rolled back
    }
    throw err;
  }
}

export interface VoidSaleResult {
  sale: SaleRecord;
  ledgerEntry: LedgerEntryRecord;
  restoredItems: number;
}

export async function voidSale(
  ctx: DatabaseContext,
  saleId: string,
  reason: string,
): Promise<VoidSaleResult> {
  const cleanReason = reason.trim();
  if (cleanReason.length < 3) {
    throw new SaleServiceError(
      "INVALID_STATE",
      400,
      "Motivo de anulación inválido",
    );
  }

  const nowIso = new Date().toISOString();
  ctx.sqlite.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    const [existing] = await ctx.db
      .select()
      .from(sales)
      .where(eq(sales.id, saleId))
      .limit(1);
    if (!existing) {
      throw new SaleServiceError(
        "SALE_NOT_FOUND",
        404,
        `Venta no encontrada: ${saleId}`,
      );
    }
    if (existing.status !== "completed") {
      throw new SaleServiceError(
        "ALREADY_VOIDED",
        409,
        `La venta ${existing.receiptNumber} ya fue anulada`,
      );
    }

    const items = await ctx.db
      .select()
      .from(saleItems)
      .where(eq(saleItems.saleId, saleId));

    await ctx.db
      .update(sales)
      .set({
        status: "voided",
        voidedAt: nowIso,
        voidReason: cleanReason,
      })
      .where(eq(sales.id, saleId));

    let restoredItems = 0;
    for (const item of items) {
      restoredItems += item.quantity;
      await ctx.db
        .update(products)
        .set({
          stock: sql`${products.stock} + ${item.quantity}`,
          updatedAt: nowIso,
        })
        .where(eq(products.id, item.productId));

      await ctx.db.insert(inventoryMovements).values({
        id: randomUUID(),
        productId: item.productId,
        delta: item.quantity,
        reason: "return",
        referenceId: existing.id,
        createdAt: nowIso,
      });
    }

    const ledgerEntry: LedgerEntryRecord = {
      id: randomUUID(),
      type: "expense",
      category: "devolucion",
      amountCents: existing.totalCents,
      description: `Devolución / Anulación ${existing.receiptNumber}: ${cleanReason}`,
      referenceId: existing.id,
      createdAt: nowIso,
    };
    await ctx.db.insert(ledgerEntries).values(ledgerEntry);

    ctx.sqlite.exec("COMMIT");
    return {
      sale: {
        ...existing,
        status: "voided",
        voidedAt: nowIso,
        voidReason: cleanReason,
      },
      ledgerEntry,
      restoredItems,
    };
  } catch (err) {
    try {
      ctx.sqlite.exec("ROLLBACK");
    } catch {
      // Already rolled back
    }
    throw err;
  }
}

export async function listSales(
  ctx: DatabaseContext,
  limit = 50,
): Promise<SaleRecord[]> {
  return ctx.db
    .select()
    .from(sales)
    .orderBy(desc(sales.createdAt))
    .limit(limit);
}

export async function getSaleWithItems(
  ctx: DatabaseContext,
  saleId: string,
): Promise<{ sale: SaleRecord; items: SaleItemDetail[] } | null> {
  const [sale] = await ctx.db
    .select()
    .from(sales)
    .where(eq(sales.id, saleId))
    .limit(1);
  if (!sale) return null;
  const items = await fetchSaleItemsWithProduct(ctx, sale.id);
  return { sale, items };
}

export async function listLedgerEntries(
  ctx: DatabaseContext,
  limit = 200,
): Promise<LedgerEntryRecord[]> {
  return ctx.db
    .select()
    .from(ledgerEntries)
    .orderBy(desc(ledgerEntries.createdAt))
    .limit(limit);
}

export interface DailySeriesPoint {
  date: string;
  revenueCents: number;
  profitCents: number;
  expenseCents: number;
  salesCount: number;
}

export interface AnalyticsSummary {
  totalRevenueCents: number;
  totalSubtotalCents: number;
  totalTaxCents: number;
  totalProfitCents: number;
  totalCostCents: number;
  totalExpenseCents: number;
  grossMarginPercent: number;
  salesCount: number;
  lowStockCount: number;
  inventoryValuationCostCents: number;
  inventoryValuationRetailCents: number;
  dailySeries: DailySeriesPoint[];
  recentSales: SaleRecord[];
  ledger: LedgerEntryRecord[];
}

export async function getAnalytics(
  ctx: DatabaseContext,
): Promise<AnalyticsSummary> {
  const [allSales, allProducts, allLedger] = await Promise.all([
    ctx.db.select().from(sales).orderBy(desc(sales.createdAt)),
    ctx.db.select().from(products).where(eq(products.isActive, true)),
    ctx.db.select().from(ledgerEntries).orderBy(desc(ledgerEntries.createdAt)),
  ]);

  let totalRevenueCents = 0;
  let totalSubtotalCents = 0;
  let totalTaxCents = 0;
  let totalProfitCents = 0;

  const dayMap = new Map<string, DailySeriesPoint>();
  const ensureDay = (dateKey: string): DailySeriesPoint => {
    const found = dayMap.get(dateKey);
    if (found) return found;
    const created: DailySeriesPoint = {
      date: dateKey,
      revenueCents: 0,
      profitCents: 0,
      expenseCents: 0,
      salesCount: 0,
    };
    dayMap.set(dateKey, created);
    return created;
  };

  let completedSalesCount = 0;
  for (const s of allSales) {
    if (s.status !== "completed") continue;
    completedSalesCount += 1;
    totalRevenueCents += s.totalCents;
    totalSubtotalCents += s.subtotalCents;
    totalTaxCents += s.taxCents;
    totalProfitCents += s.profitCents;
    const point = ensureDay(s.createdAt.slice(0, 10));
    point.revenueCents += s.totalCents;
    point.profitCents += s.profitCents;
    point.salesCount += 1;
  }

  let totalExpenseCents = 0;
  for (const entry of allLedger) {
    if (entry.type === "expense") {
      totalExpenseCents += entry.amountCents;
      ensureDay(entry.createdAt.slice(0, 10)).expenseCents += entry.amountCents;
    }
  }

  const totalCostCents = totalSubtotalCents - totalProfitCents;
  const grossMarginPercent = calculateGrossMarginPercent(
    totalSubtotalCents,
    totalCostCents,
  );

  let lowStockCount = 0;
  let inventoryValuationCostCents = 0;
  let inventoryValuationRetailCents = 0;
  for (const p of allProducts) {
    if (p.stock <= p.minStock) lowStockCount += 1;
    inventoryValuationCostCents += p.costCents * p.stock;
    inventoryValuationRetailCents += p.priceCents * p.stock;
  }

  const dailySeries = Array.from(dayMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14);

  return {
    totalRevenueCents,
    totalSubtotalCents,
    totalTaxCents,
    totalProfitCents,
    totalCostCents,
    totalExpenseCents,
    grossMarginPercent,
    salesCount: completedSalesCount,
    lowStockCount,
    inventoryValuationCostCents,
    inventoryValuationRetailCents,
    dailySeries,
    recentSales: allSales.slice(0, 25),
    ledger: allLedger.slice(0, 100),
  };
}
