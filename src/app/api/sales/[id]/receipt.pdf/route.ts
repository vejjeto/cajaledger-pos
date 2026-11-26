import { generateReceiptPdfBuffer } from "@/core/pdf";
import { getSaleWithItems } from "@/core/sales-service";
import { getSeededDbContext } from "@/db/ensure-ready";
import { getRequestId } from "@/lib/logger";
import { problemResponse } from "@/lib/problem-details";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const requestId = getRequestId(request);
  const ctx = await getSeededDbContext();
  const data = await getSaleWithItems(ctx, id);

  if (!data) {
    return problemResponse({
      status: 404,
      title: "Venta no encontrada",
      detail: `No existe la venta ${id}`,
      code: "SALE_NOT_FOUND",
      requestId,
      instance: `/api/sales/${id}/receipt.pdf`,
    });
  }

  const pdfBytes = await generateReceiptPdfBuffer(data.sale, data.items);
  return new Response(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="recibo-${data.sale.receiptNumber}.pdf"`,
      "Cache-Control": "no-store",
      "x-request-id": requestId,
    },
  });
}
