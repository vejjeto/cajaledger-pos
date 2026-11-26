import { renderOpenApiDocsHtml } from "@/lib/openapi";

export const dynamic = "force-dynamic";

export async function GET() {
  const html = renderOpenApiDocsHtml({
    title: "CajaLedger API",
    specUrl: "/api/openapi.json",
  });
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
