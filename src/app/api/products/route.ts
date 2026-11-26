import { CreateProductSchema } from "@/contracts/schemas";
import {
  SaleServiceError,
  createProduct,
  listProducts,
} from "@/core/sales-service";
import { getSeededDbContext } from "@/db/ensure-ready";
import { getRequestLogger } from "@/lib/logger";
import { jsonResponse, problemResponse } from "@/lib/problem-details";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { requestId } = getRequestLogger(request);
  const ctx = await getSeededDbContext();
  const items = await listProducts(ctx);
  return jsonResponse({ products: items }, { requestId });
}

export async function POST(request: Request) {
  const { requestId, log } = getRequestLogger(request);
  try {
    const raw: unknown = await request.json();
    const parsed = CreateProductSchema.safeParse(raw);
    if (!parsed.success) {
      return problemResponse({
        status: 400,
        title: "Datos de producto inválidos",
        detail: "El producto no cumple con el esquema requerido.",
        code: "VALIDATION_ERROR",
        errors: parsed.error.flatten(),
        requestId,
        instance: "/api/products",
      });
    }

    const ctx = await getSeededDbContext();
    const product = await createProduct(ctx, parsed.data);
    log.info({ productId: product.id, sku: product.sku }, "Product created");
    return jsonResponse({ product }, { status: 201, requestId });
  } catch (err) {
    if (err instanceof SaleServiceError) {
      return problemResponse({
        status: err.statusCode,
        title: err.code,
        detail: err.message,
        code: err.code,
        requestId,
        instance: "/api/products",
      });
    }
    log.error({ err }, "Error creating product");
    return problemResponse({
      status: 500,
      title: "Internal Server Error",
      detail: "Error creando producto",
      requestId,
      instance: "/api/products",
    });
  }
}
