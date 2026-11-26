import { RestockProductSchema } from "@/contracts/schemas";
import { SaleServiceError, restockProduct } from "@/core/sales-service";
import { getSeededDbContext } from "@/db/ensure-ready";
import { getRequestLogger } from "@/lib/logger";
import { jsonResponse, problemResponse } from "@/lib/problem-details";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const { requestId, log } = getRequestLogger(request);
  try {
    const raw: unknown = await request.json();
    const parsed = RestockProductSchema.safeParse(raw);
    if (!parsed.success) {
      return problemResponse({
        status: 400,
        title: "Cantidad de reabastecimiento inválida",
        detail: "El payload de reabastecimiento es inválido.",
        code: "VALIDATION_ERROR",
        errors: parsed.error.flatten(),
        requestId,
        instance: `/api/products/${id}/restock`,
      });
    }

    const ctx = await getSeededDbContext();
    const product = await restockProduct(ctx, id, parsed.data);
    log.info({ productId: id, stock: product.stock }, "Product restocked");
    return jsonResponse({ product }, { requestId });
  } catch (err) {
    if (err instanceof SaleServiceError) {
      return problemResponse({
        status: err.statusCode,
        title: err.code,
        detail: err.message,
        code: err.code,
        requestId,
        instance: `/api/products/${id}/restock`,
      });
    }
    log.error({ err, productId: id }, "Error restocking product");
    return problemResponse({
      status: 500,
      title: "Internal Server Error",
      detail: "Error reabasteciendo inventario",
      requestId,
      instance: `/api/products/${id}/restock`,
    });
  }
}
