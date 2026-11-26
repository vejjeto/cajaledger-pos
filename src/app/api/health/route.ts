import { getSeededDbContext } from "@/db/ensure-ready";
import { getRequestLogger } from "@/lib/logger";
import { jsonResponse, problemResponse } from "@/lib/problem-details";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { requestId, log } = getRequestLogger(request);
  const start = performance.now();
  try {
    const ctx = await getSeededDbContext();
    ctx.sqlite.prepare("SELECT 1").get();
    const row = ctx.sqlite
      .prepare(
        "SELECT (SELECT COUNT(*) FROM products) AS productsCount, (SELECT COUNT(*) FROM sales) AS salesCount",
      )
      .get();
    const dbLatencyMs = Number((performance.now() - start).toFixed(2));

    return jsonResponse(
      {
        status: "ok",
        service: "cajaledger-pos",
        version: "2.0.0",
        timestamp: new Date().toISOString(),
        dbLatencyMs,
        details: {
          engine: "node:sqlite+drizzle-proxy",
          monetaryUnit: "integer-cents",
          productsCount: Number(row?.productsCount ?? 0),
          salesCount: Number(row?.salesCount ?? 0),
        },
      },
      { requestId },
    );
  } catch (err) {
    log.error({ err }, "Health check failed");
    return problemResponse({
      status: 503,
      title: "Service Unavailable",
      detail: "Database health check failed",
      requestId,
      instance: "/api/health",
    });
  }
}
