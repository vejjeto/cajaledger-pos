import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text } from "drizzle-orm/pg-core";

// Mirror PostgreSQL schema used in production with `SELECT ... FOR UPDATE` row locking
// inside `db.transaction` for createSale & voidSale (equivalent to SQLite `BEGIN IMMEDIATE`).
export const productsPg = pgTable(
  "products",
  {
    id: text("id").primaryKey(),
    sku: text("sku").notNull().unique(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    costCents: integer("cost_cents").notNull(),
    priceCents: integer("price_cents").notNull(),
    stock: integer("stock").notNull(),
    minStock: integer("min_stock").notNull().default(5),
    isActive: boolean("is_active").notNull().default(true),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("products_cost_nonneg", sql`${table.costCents} >= 0`),
    check("products_price_nonneg", sql`${table.priceCents} >= 0`),
    check("products_stock_nonneg", sql`${table.stock} >= 0`),
  ],
);

export const salesPg = pgTable("sales", {
  id: text("id").primaryKey(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  receiptNumber: text("receipt_number").notNull().unique(),
  paymentMethod: text("payment_method").notNull(),
  status: text("status").notNull().default("completed"),
  subtotalCents: integer("subtotal_cents").notNull(),
  taxCents: integer("tax_cents").notNull(),
  totalCents: integer("total_cents").notNull(),
  profitCents: integer("profit_cents").notNull(),
  createdOfflineAt: text("created_offline_at"),
  voidedAt: text("voided_at"),
  voidReason: text("void_reason"),
  createdAt: text("created_at").notNull(),
});

export const saleItemsPg = pgTable(
  "sale_items",
  {
    id: text("id").primaryKey(),
    saleId: text("sale_id")
      .notNull()
      .references(() => salesPg.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => productsPg.id),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    unitCostCents: integer("unit_cost_cents").notNull(),
  },
  (table) => [check("sale_items_qty_pos", sql`${table.quantity} > 0`)],
);

export const inventoryMovementsPg = pgTable("inventory_movements", {
  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => productsPg.id),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(),
  referenceId: text("reference_id"),
  createdAt: text("created_at").notNull(),
});

export const ledgerEntriesPg = pgTable(
  "ledger_entries",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    category: text("category").notNull(),
    amountCents: integer("amount_cents").notNull(),
    description: text("description").notNull(),
    referenceId: text("reference_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [check("ledger_amount_pos", sql`${table.amountCents} > 0`)],
);
