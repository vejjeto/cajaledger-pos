import { getAnalytics } from "@/core/sales-service";
import { getSeededDbContext } from "@/db/ensure-ready";
import { getRequestId } from "@/lib/logger";
import { jsonResponse } from "@/lib/problem-details";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  const ctx = await getSeededDbContext();
  const summary = await getAnalytics(ctx);
  return jsonResponse(summary, { requestId });
}
