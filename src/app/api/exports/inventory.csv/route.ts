import { buildInventoryCsv } from "@/core/csv";
import { listProducts } from "@/core/sales-service";
import { getSeededDbContext } from "@/db/ensure-ready";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getSeededDbContext();
  const items = await listProducts(ctx);
  const csv = buildInventoryCsv(items);

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="cajaledger-inventario.csv"',
      "Cache-Control": "no-store",
    },
  });
}
