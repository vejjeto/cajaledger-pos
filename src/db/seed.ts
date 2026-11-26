import { randomUUID } from "node:crypto";
import { count } from "drizzle-orm";
import { DEFAULT_TAX_BPS, calculateSaleTotals } from "../core/money";
import { logger } from "../lib/logger";
import { type DatabaseContext, getDbContext } from "./index";
import {
  inventoryMovements,
  ledgerEntries,
  products,
  saleItems,
  sales,
} from "./schema";

export const DEMO_PRODUCTS = [
  {
    id: "prod-01",
    sku: "TECH-USB-C65",
    name: "Cargador GaN 65W USB-C",
    category: "Energía",
    costCents: 24500,
    priceCents: 49900,
    stock: 28,
    minStock: 6,
  },
  {
    id: "prod-02",
    sku: "TECH-HUB-7IN1",
    name: "Hub USB-C 7 en 1 HDMI 4K",
    category: "Accesorios",
    costCents: 31000,
    priceCents: 64900,
    stock: 18,
    minStock: 5,
  },
  {
    id: "prod-03",
    sku: "TECH-SSD-1TB",
    name: "SSD NVMe Externo 1TB",
    category: "Almacenamiento",
    costCents: 98000,
    priceCents: 169900,
    stock: 9,
    minStock: 4,
  },
  {
    id: "prod-04",
    sku: "TECH-KEY-MECH",
    name: "Teclado Mecánico Low-Profile",
    category: "Periféricos",
    costCents: 62000,
    priceCents: 124900,
    stock: 12,
    minStock: 4,
  },
  {
    id: "prod-05",
    sku: "TECH-MSE-PRO",
    name: "Mouse Ergonómico Inalámbrico",
    category: "Periféricos",
    costCents: 29000,
    priceCents: 59900,
    stock: 22,
    minStock: 5,
  },
  {
    id: "prod-06",
    sku: "AUDIO-ANC-01",
    name: "Audífonos Bluetooth ANC",
    category: "Audio",
    costCents: 74000,
    priceCents: 149900,
    stock: 11,
    minStock: 4,
  },
  {
    id: "prod-07",
    sku: "AUDIO-MIC-USB",
    name: "Micrófono Condensador USB",
    category: "Audio",
    costCents: 46000,
    priceCents: 89900,
    stock: 7,
    minStock: 3,
  },
  {
    id: "prod-08",
    sku: "CAB-USBC-2M",
    name: "Cable USB-C Trenzado 2m 100W",
    category: "Cables",
    costCents: 6500,
    priceCents: 18900,
    stock: 54,
    minStock: 12,
  },
  {
    id: "prod-09",
    sku: "CAB-HDMI-21",
    name: "Cable HDMI 2.1 Ultra 8K",
    category: "Cables",
    costCents: 9500,
    priceCents: 24900,
    stock: 31,
    minStock: 8,
  },
  {
    id: "prod-10",
    sku: "ERG-STAND-AL",
    name: "Soporte Aluminio Laptop",
    category: "Ergonomía",
    costCents: 21000,
    priceCents: 44900,
    stock: 15,
    minStock: 4,
  },
  {
    id: "prod-11",
    sku: "NET-WIFI6-AX",
    name: "Adaptador Wi-Fi 6E USB",
    category: "Redes",
    costCents: 26000,
    priceCents: 54900,
    stock: 4,
    minStock: 5,
  },
  {
    id: "prod-12",
    sku: "CAM-WEB-FHD",
    name: "Webcam 1080p 60fps Privacy",
    category: "Video",
    costCents: 39000,
    priceCents: 79900,
    stock: 14,
    minStock: 4,
  },
  {
    id: "prod-13",
    sku: "POW-BANK-20K",
    name: "Power Bank 20,000mAh PD",
    category: "Energía",
    costCents: 35000,
    priceCents: 74900,
    stock: 16,
    minStock: 5,
  },
  {
    id: "prod-14",
    sku: "CLN-SCREEN-KIT",
    name: "Kit Limpieza Óptica Pantallas",
    category: "Cuidado",
    costCents: 4200,
    priceCents: 12900,
    stock: 40,
    minStock: 10,
  },
  {
    id: "prod-15",
    sku: "SLEEVE-14-PRO",
    name: 'Funda Neopreno Laptop 14"',
    category: "Accesorios",
    costCents: 13500,
    priceCents: 32900,
    stock: 3,
    minStock: 5,
  },
] as const;

const PAYMENT_METHODS = ["cash", "card", "transfer"] as const;

export async function seedDatabase(
  ctx: DatabaseContext,
): Promise<{ productsSeeded: number; salesSeeded: number }> {
  const [existingProductsRow] = await ctx.db
    .select({ total: count() })
    .from(products);
  if ((existingProductsRow?.total ?? 0) > 0) {
    const [existingSalesRow] = await ctx.db
      .select({ total: count() })
      .from(sales);
    return { productsSeeded: 0, salesSeeded: existingSalesRow?.total ?? 0 };
  }

  const now = new Date();
  const baseIso = now.toISOString();

  ctx.sqlite.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    for (const p of DEMO_PRODUCTS) {
      await ctx.db.insert(products).values({
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        costCents: p.costCents,
        priceCents: p.priceCents,
        stock: p.stock,
        minStock: p.minStock,
        isActive: true,
        updatedAt: baseIso,
      });

      await ctx.db.insert(inventoryMovements).values({
        id: randomUUID(),
        productId: p.id,
        delta: p.stock,
        reason: "restock",
        referenceId: "SEED-INITIAL",
        createdAt: new Date(now.getTime() - 15 * 86400_000).toISOString(),
      });
    }

    let salesCount = 0;
    for (let daysAgo = 13; daysAgo >= 0; daysAgo--) {
      const daySales = daysAgo % 3 === 0 ? 3 : 2;
      for (let slot = 0; slot < daySales; slot++) {
        salesCount += 1;
        const p1 = DEMO_PRODUCTS[(daysAgo * 3 + slot) % DEMO_PRODUCTS.length]!;
        const p2 =
          DEMO_PRODUCTS[(daysAgo * 5 + slot + 4) % DEMO_PRODUCTS.length]!;
        const qty1 = (slot % 2) + 1;
        const qty2 = 1;
        const lines =
          p1.id === p2.id
            ? [{ product: p1, quantity: qty1 }]
            : [
                { product: p1, quantity: qty1 },
                { product: p2, quantity: qty2 },
              ];

        const totals = calculateSaleTotals(
          lines.map((l) => ({
            quantity: l.quantity,
            unitPriceCents: l.product.priceCents,
            unitCostCents: l.product.costCents,
          })),
          DEFAULT_TAX_BPS,
        );

        const createdAt = new Date(
          now.getTime() - daysAgo * 86400_000 - (slot + 1) * 3600_000,
        ).toISOString();
        const saleId = `seed-sale-${String(salesCount).padStart(3, "0")}`;
        const receiptNumber = `CL-2026-${String(1000 + salesCount)}`;
        const paymentMethod =
          PAYMENT_METHODS[(daysAgo + slot) % PAYMENT_METHODS.length]!;

        await ctx.db.insert(sales).values({
          id: saleId,
          idempotencyKey: `00000000-0000-4000-8000-${String(salesCount).padStart(12, "0")}`,
          receiptNumber,
          paymentMethod,
          subtotalCents: totals.subtotalCents,
          taxCents: totals.taxCents,
          totalCents: totals.totalCents,
          profitCents: totals.profitCents,
          createdOfflineAt: null,
          createdAt,
        });

        for (const line of lines) {
          await ctx.db.insert(saleItems).values({
            id: randomUUID(),
            saleId,
            productId: line.product.id,
            quantity: line.quantity,
            unitPriceCents: line.product.priceCents,
            unitCostCents: line.product.costCents,
          });
          await ctx.db.insert(inventoryMovements).values({
            id: randomUUID(),
            productId: line.product.id,
            delta: -line.quantity,
            reason: "sale",
            referenceId: saleId,
            createdAt,
          });
        }

        await ctx.db.insert(ledgerEntries).values({
          id: randomUUID(),
          type: "income",
          category: "venta_pos",
          amountCents: totals.totalCents,
          description: `Venta POS ${receiptNumber}`,
          referenceId: saleId,
          createdAt,
        });
      }

      if (daysAgo === 10 || daysAgo === 4) {
        const expenseAt = new Date(
          now.getTime() - daysAgo * 86400_000 - 4 * 3600_000,
        ).toISOString();
        await ctx.db.insert(ledgerEntries).values({
          id: randomUUID(),
          type: "expense",
          category: daysAgo === 10 ? "reabastecimiento" : "operacion",
          amountCents: daysAgo === 10 ? 185000 : 65000,
          description:
            daysAgo === 10
              ? "Compra lote Cables USB-C & Cargadores"
              : "Renta terminal bancaria & empaques",
          referenceId: `SEED-EXP-${daysAgo}`,
          createdAt: expenseAt,
        });
      }
    }

    ctx.sqlite.exec("COMMIT");
    return { productsSeeded: DEMO_PRODUCTS.length, salesSeeded: salesCount };
  } catch (err) {
    ctx.sqlite.exec("ROLLBACK");
    throw err;
  }
}

const isCli =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1]?.endsWith("seed.ts");

if (isCli) {
  const ctx = getDbContext();
  seedDatabase(ctx)
    .then((res) => {
      logger.info(res, "CajaLedger seed completed");
    })
    .catch((err) => {
      logger.error({ err }, "CajaLedger seed failed");
      process.exit(1);
    });
}
