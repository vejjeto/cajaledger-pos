import { VoidSaleSchema } from "@/contracts/schemas";
import { SaleServiceError, voidSale } from "@/core/sales-service";
import { getSeededDbContext } from "@/db/ensure-ready";
import { getRequestLogger } from "@/lib/logger";
import { jsonResponse, problemResponse } from "@/lib/problem-details";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const { requestId, log } = getRequestLogger(request);
  try {
    const raw: unknown = await request.json();
    const parsed = VoidSaleSchema.safeParse(raw);
    if (!parsed.success) {
      return problemResponse({
        status: 400,
        title: "Motivo de anulación inválido",
        detail: "Debes proporcionar un motivo de al menos 3 caracteres.",
        code: "VALIDATION_ERROR",
        errors: parsed.error.flatten(),
        requestId,
        instance: `/api/sales/${id}/void`,
      });
    }

    const ctx = await getSeededDbContext();
    const result = await voidSale(ctx, id, parsed.data.reason);
    log.info(
      {
        event: "sale.voided",
        saleId: result.sale.id,
        receiptNumber: result.sale.receiptNumber,
        amountCents: result.ledgerEntry.amountCents,
        restoredItems: result.restoredItems,
      },
      "Sale voided with immutable counter-entry",
    );

    return jsonResponse(result, { status: 200, requestId });
  } catch (err) {
    if (err instanceof SaleServiceError) {
      return problemResponse({
        status: err.statusCode,
        title: err.code,
        detail: err.message,
        code: err.code,
        requestId,
        instance: `/api/sales/${id}/void`,
      });
    }
    log.error({ err, saleId: id }, "Error voiding sale");
    return problemResponse({
      status: 500,
      title: "Internal Server Error",
      detail: "Error anulando venta",
      requestId,
      instance: `/api/sales/${id}/void`,
    });
  }
}
