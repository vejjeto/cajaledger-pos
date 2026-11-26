import type { SaleItemDetail, SaleRecord } from "@/contracts/schemas";
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import React from "react";
import { formatCents } from "./money";

const styles = StyleSheet.create({
  page: {
    padding: 28,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#18181b",
  },
  header: {
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#d4d4d8",
    paddingBottom: 10,
  },
  title: { fontSize: 16, fontWeight: 700, marginBottom: 4 },
  meta: { fontSize: 9, color: "#52525b", marginBottom: 2 },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#a1a1aa",
    paddingBottom: 4,
    marginBottom: 4,
    fontWeight: 700,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e4e4e7",
  },
  colName: { flex: 3 },
  colQty: { flex: 1, textAlign: "right" },
  colPrice: { flex: 1.3, textAlign: "right" },
  colTotal: { flex: 1.4, textAlign: "right" },
  totals: { marginTop: 14, alignItems: "flex-end" },
  totalLine: {
    flexDirection: "row",
    width: 200,
    justifyContent: "space-between",
    marginBottom: 3,
  },
  grandTotal: {
    flexDirection: "row",
    width: 200,
    justifyContent: "space-between",
    marginTop: 4,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#18181b",
    fontSize: 12,
    fontWeight: 700,
  },
  footer: { marginTop: 22, fontSize: 8, color: "#71717a" },
});

function sanitizePdfText(text: string): string {
  return text.replace(/[^\x20-\x7E]/g, "?").replace(/[()\\]/g, "\\$&");
}

export function buildMinimalPdfReceipt(
  sale: SaleRecord,
  items: readonly SaleItemDetail[],
): Uint8Array {
  const lines: string[] = [
    `CajaLedger - Recibo ${sale.receiptNumber}`,
    `Fecha: ${sale.createdAt}`,
    `Metodo: ${sale.paymentMethod} | Idempotencia: ${sale.idempotencyKey}`,
    "------------------------------------------------------------",
    ...items.map(
      (i) =>
        `${i.quantity}x ${i.productName} (${i.sku}) @ ${formatCents(i.unitPriceCents)} = ${formatCents(i.unitPriceCents * i.quantity)}`,
    ),
    "------------------------------------------------------------",
    `Subtotal: ${formatCents(sale.subtotalCents)}`,
    `IVA:      ${formatCents(sale.taxCents)}`,
    `TOTAL:    ${formatCents(sale.totalCents)}`,
  ];

  const textOps = lines
    .map((line, idx) => {
      const y = 760 - idx * 16;
      return `BT /F1 10 Tf 40 ${y} Td (${sanitizePdfText(line)}) Tj ET`;
    })
    .join("\n");

  const streamBytes = Buffer.byteLength(textOps, "utf8");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
    `4 0 obj << /Length ${streamBytes} >>\nstream\n${textOps}\nendstream\nendobj\n`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += obj;
  }
  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(pdf, "utf8"));
}

function ReceiptDocument({
  sale,
  items,
}: { sale: SaleRecord; items: readonly SaleItemDetail[] }) {
  return (
    <Document title={`Recibo ${sale.receiptNumber}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>
            CajaLedger POS — Comprobante de Venta
          </Text>
          <Text style={styles.meta}>Recibo: {sale.receiptNumber}</Text>
          <Text style={styles.meta}>Fecha: {sale.createdAt}</Text>
          <Text style={styles.meta}>
            Método de pago: {sale.paymentMethod.toUpperCase()}
          </Text>
          <Text style={styles.meta}>
            Clave idempotencia: {sale.idempotencyKey}
          </Text>
        </View>

        <View style={styles.tableHeader}>
          <Text style={styles.colName}>Producto</Text>
          <Text style={styles.colQty}>Cant.</Text>
          <Text style={styles.colPrice}>Unitario</Text>
          <Text style={styles.colTotal}>Importe</Text>
        </View>

        {items.map((item) => (
          <View key={item.id} style={styles.row}>
            <Text style={styles.colName}>
              {item.productName} ({item.sku})
            </Text>
            <Text style={styles.colQty}>{item.quantity}</Text>
            <Text style={styles.colPrice}>
              {formatCents(item.unitPriceCents)}
            </Text>
            <Text style={styles.colTotal}>
              {formatCents(item.unitPriceCents * item.quantity)}
            </Text>
          </View>
        ))}

        <View style={styles.totals}>
          <View style={styles.totalLine}>
            <Text>Subtotal</Text>
            <Text>{formatCents(sale.subtotalCents)}</Text>
          </View>
          <View style={styles.totalLine}>
            <Text>IVA (16%)</Text>
            <Text>{formatCents(sale.taxCents)}</Text>
          </View>
          <View style={styles.grandTotal}>
            <Text>TOTAL</Text>
            <Text>{formatCents(sale.totalCents)}</Text>
          </View>
        </View>

        <Text style={styles.footer}>
          Generado con aritmética exacta en centavos enteros · CajaLedger ACID
          POS
        </Text>
      </Page>
    </Document>
  );
}

export async function generateReceiptPdfBuffer(
  sale: SaleRecord,
  items: readonly SaleItemDetail[],
): Promise<Uint8Array> {
  try {
    const buffer = await renderToBuffer(
      <ReceiptDocument sale={sale} items={items} />,
    );
    const bytes = new Uint8Array(buffer);
    if (
      bytes.length > 8 &&
      Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-"
    ) {
      return bytes;
    }
    return buildMinimalPdfReceipt(sale, items);
  } catch {
    return buildMinimalPdfReceipt(sale, items);
  }
}
