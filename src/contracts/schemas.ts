import { z } from "zod";

export const PaymentMethodSchema = z.enum(["cash", "card", "transfer"]);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const SaleStatusSchema = z.enum(["completed", "voided"]);
export type SaleStatus = z.infer<typeof SaleStatusSchema>;

export const VoidSaleSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, "Motivo requerido (mín. 3 caracteres)")
    .max(200),
});
export type VoidSaleInput = z.infer<typeof VoidSaleSchema>;

export const SaleItemInputSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive().max(10000),
});

export const CreateSaleSchema = z.object({
  idempotencyKey: z.string().uuid("idempotencyKey debe ser un UUID válido"),
  paymentMethod: PaymentMethodSchema,
  taxBps: z.number().int().min(0).max(5000).optional(),
  createdOfflineAt: z.string().datetime().optional(),
  items: z
    .array(SaleItemInputSchema)
    .min(1, "La venta debe incluir al menos un producto"),
});

export type CreateSaleInput = z.infer<typeof CreateSaleSchema>;

export const CreateProductSchema = z.object({
  sku: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(60),
  costCents: z.number().int().nonnegative(),
  priceCents: z.number().int().nonnegative(),
  stock: z.number().int().nonnegative(),
  minStock: z.number().int().nonnegative().default(5),
});

export type CreateProductInput = z.infer<typeof CreateProductSchema>;

export const RestockProductSchema = z.object({
  quantity: z.number().int().positive().max(100000),
  note: z.string().trim().max(200).optional(),
  recordExpense: z.boolean().optional().default(true),
});

export type RestockProductInput = z.infer<typeof RestockProductSchema>;

export interface ProductRecord {
  id: string;
  sku: string;
  name: string;
  category: string;
  costCents: number;
  priceCents: number;
  stock: number;
  minStock: number;
  isActive: boolean;
  updatedAt: string;
}

export interface SaleItemDetail {
  id: string;
  saleId: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
}

export interface SaleRecord {
  id: string;
  idempotencyKey: string;
  receiptNumber: string;
  paymentMethod: PaymentMethod;
  status: SaleStatus;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  profitCents: number;
  createdOfflineAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
}

export interface CreateSaleResult {
  sale: SaleRecord;
  items: SaleItemDetail[];
  idempotentReplay: boolean;
}

export interface LedgerEntryRecord {
  id: string;
  type: "income" | "expense";
  category: string;
  amountCents: number;
  description: string;
  referenceId: string | null;
  createdAt: string;
}

export interface StockConflictItem {
  productId: string;
  productName: string;
  requested: number;
  available: number;
}
