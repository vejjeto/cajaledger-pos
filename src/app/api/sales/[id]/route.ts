import { getRequestId } from "@/lib/logger";
import { problemResponse } from "@/lib/problem-details";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const requestId = getRequestId(request);
  return problemResponse({
    status: 405,
    title: "Method Not Allowed",
    detail:
      "El libro contable de CajaLedger es inmutable (append-only). No se permite eliminar ventas; usa POST /api/sales/{id}/void para emitir un contra-asiento.",
    code: "IMMUTABLE_LEDGER",
    instance: `/api/sales/${id}`,
    requestId,
    headers: { Allow: "GET, POST" },
  });
}
