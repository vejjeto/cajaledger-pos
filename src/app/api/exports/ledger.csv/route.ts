import { buildLedgerCsv } from "@/core/csv";
import { listLedgerEntries } from "@/core/sales-service";
import { getSeededDbContext } from "@/db/ensure-ready";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getSeededDbContext();
  const entries = await listLedgerEntries(ctx, 1000);
  const csv = buildLedgerCsv(entries);

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="cajaledger-libro-contable.csv"',
      "Cache-Control": "no-store",
    },
  });
}
