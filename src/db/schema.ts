import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  sku: text("sku").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  costCents: integer("cost_cents").notNull(),
  priceCents: integer("price_cents").notNull(),
  stock: integer("stock").notNull(),
  minStock: integer("min_stock").notNull().default(5),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at").notNull(),
});

export const sales = sqliteTable("sales", {
  id: text("id").primaryKey(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  receiptNumber: text("receipt_number").notNull().unique(),
  paymentMethod: text("payment_method", {
    enum: ["cash", "card", "transfer"],
  }).notNull(),
  status: text("status", { enum: ["completed", "voided"] })
    .notNull()
    .default("completed"),
  subtotalCents: integer("subtotal_cents").notNull(),
  taxCents: integer("tax_cents").notNull(),
  totalCents: integer("total_cents").notNull(),
  profitCents: integer("profit_cents").notNull(),
  createdOfflineAt: text("created_offline_at"),
  voidedAt: text("voided_at"),
  voidReason: text("void_reason"),
  createdAt: text("created_at").notNull(),
});

export const saleItems = sqliteTable("sale_items", {
  id: text("id").primaryKey(),
  saleId: text("sale_id")
    .notNull()
    .references(() => sales.id, { onDelete: "cascade" }),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  quantity: integer("quantity").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  unitCostCents: integer("unit_cost_cents").notNull(),
});

export const inventoryMovements = sqliteTable("inventory_movements", {
  id: text("id").primaryKey(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  delta: integer("delta").notNull(),
  reason: text("reason", {
    enum: ["sale", "restock", "adjustment", "return"],
  }).notNull(),
  referenceId: text("reference_id"),
  createdAt: text("created_at").notNull(),
});

export const ledgerEntries = sqliteTable("ledger_entries", {
  id: text("id").primaryKey(),
  type: text("type", { enum: ["income", "expense"] }).notNull(),
  category: text("category").notNull(),
  amountCents: integer("amount_cents").notNull(),
  description: text("description").notNull(),
  referenceId: text("reference_id"),
  createdAt: text("created_at").notNull(),
});
