import type { LedgerEntryRecord, ProductRecord } from "@/contracts/schemas";
import { formatCents } from "./money";

export function escapeCsvCell(
  raw: string | number | boolean | null | undefined,
): string {
  const str = raw === null || raw === undefined ? "" : String(raw);
  const mustQuote = /[",\r\n]/.test(str);
  if (!mustQuote) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

export function buildCsv(
  headers: readonly string[],
  rows: readonly (readonly (string | number | boolean | null | undefined)[])[],
): string {
  const lines = [headers.map((h) => escapeCsvCell(h)).join(",")];
  for (const row of rows) {
    lines.push(row.map((cell) => escapeCsvCell(cell)).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function buildLedgerCsv(entries: readonly LedgerEntryRecord[]): string {
  const headers = [
    "id",
    "fecha",
    "tipo",
    "categoria",
    "monto_centavos",
    "monto_formateado",
    "descripcion",
    "referencia",
  ];
  const rows = entries.map((e) => [
    e.id,
    e.createdAt,
    e.type,
    e.category,
    e.amountCents,
    formatCents(e.amountCents),
    e.description,
    e.referenceId ?? "",
  ]);
  return buildCsv(headers, rows);
}

export function buildInventoryCsv(items: readonly ProductRecord[]): string {
  const headers = [
    "id",
    "sku",
    "nombre",
    "categoria",
    "costo_centavos",
    "precio_centavos",
    "costo",
    "precio",
    "stock",
    "stock_minimo",
    "actualizado_en",
  ];
  const rows = items.map((p) => [
    p.id,
    p.sku,
    p.name,
    p.category,
    p.costCents,
    p.priceCents,
    formatCents(p.costCents),
    formatCents(p.priceCents),
    p.stock,
    p.minStock,
    p.updatedAt,
  ]);
  return buildCsv(headers, rows);
}
