import { getRequestId } from "@/lib/logger";
import { buildCajaLedgerOpenApiSpec } from "@/lib/openapi";
import { jsonResponse } from "@/lib/problem-details";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return jsonResponse(buildCajaLedgerOpenApiSpec(origin), {
    requestId: getRequestId(request),
  });
}
