import { CreateSaleSchema } from "@/contracts/schemas";
import { SaleServiceError, createSale, listSales } from "@/core/sales-service";
import { getSeededDbContext } from "@/db/ensure-ready";
import { getRequestLogger } from "@/lib/logger";
import { jsonResponse, problemResponse } from "@/lib/problem-details";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { requestId } = getRequestLogger(request);
  const ctx = await getSeededDbContext();
  const items = await listSales(ctx, 50);
  return jsonResponse({ sales: items }, { requestId });
}

export async function POST(request: Request) {
  const { requestId, log } = getRequestLogger(request);
  try {
    const raw: unknown = await request.json();
    const parsed = CreateSaleSchema.safeParse(raw);
    if (!parsed.success) {
      return problemResponse({
        status: 400,
        title: "Payload de venta inválido",
        detail: "El cuerpo de la venta no cumple con el esquema requerido.",
        code: "VALIDATION_ERROR",
        errors: parsed.error.flatten(),
        requestId,
        instance: "/api/sales",
      });
    }

    const ctx = await getSeededDbContext();
    const result = await createSale(ctx, parsed.data);

    if (!result.idempotentReplay) {
      log.info(
        {
          event: "sale.completed",
          saleId: result.sale.id,
          receiptNumber: result.sale.receiptNumber,
          paymentMethod: result.sale.paymentMethod,
          totalCents: result.sale.totalCents,
          profitCents: result.sale.profitCents,
        },
        "ACID sale committed",
      );
    }

    return jsonResponse(result, {
      status: result.idempotentReplay ? 200 : 201,
      requestId,
    });
  } catch (err) {
    if (err instanceof SaleServiceError) {
      return problemResponse({
        status: err.statusCode,
        title: err.code,
        detail: err.message,
        code: err.code,
        errors: err.details,
        requestId,
        instance: "/api/sales",
      });
    }
    log.error({ err }, "Error processing ACID sale");
    return problemResponse({
      status: 500,
      title: "Internal Server Error",
      detail: "Error procesando venta ACID",
      requestId,
      instance: "/api/sales",
    });
  }
}
