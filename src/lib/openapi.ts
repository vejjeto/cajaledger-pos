import {
  CreateProductSchema,
  CreateSaleSchema,
  RestockProductSchema,
  VoidSaleSchema,
} from "@/contracts/schemas";
import { z } from "zod";

interface RouteSpec {
  path: string;
  method: "get" | "post" | "put" | "patch" | "delete";
  tag: string;
  summary: string;
  requestSchema?: z.ZodTypeAny;
  responses?: Record<string, { description: string }>;
}

function zodSchemaToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, field] of Object.entries(shape)) {
      properties[key] = zodSchemaToJsonSchema(field);
      if (!field.isOptional()) {
        required.push(key);
      }
    }
    return {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    return zodSchemaToJsonSchema(schema._def.innerType as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodArray) {
    return {
      type: "array",
      items: zodSchemaToJsonSchema(schema.element as z.ZodTypeAny),
    };
  }
  if (schema instanceof z.ZodEnum) {
    return { type: "string", enum: schema.options as string[] };
  }
  if (schema instanceof z.ZodNumber) {
    return { type: schema.isInt ? "integer" : "number" };
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: "boolean" };
  }
  return { type: "string" };
}

export function buildCajaLedgerOpenApiSpec(
  serverUrl = "http://localhost:3009",
) {
  const routes: RouteSpec[] = [
    {
      path: "/api/health",
      method: "get",
      tag: "Observabilidad",
      summary: "Estado de salud y latencia SQLite",
    },
    {
      path: "/api/products",
      method: "get",
      tag: "Inventario",
      summary: "Listar productos activos",
    },
    {
      path: "/api/products",
      method: "post",
      tag: "Inventario",
      summary: "Crear producto en catálogo",
      requestSchema: CreateProductSchema,
    },
    {
      path: "/api/products/{id}/restock",
      method: "post",
      tag: "Inventario",
      summary: "Reabastecer stock atómicamente",
      requestSchema: RestockProductSchema,
    },
    {
      path: "/api/sales",
      method: "get",
      tag: "Ventas POS",
      summary: "Listar ventas recientes",
    },
    {
      path: "/api/sales",
      method: "post",
      tag: "Ventas POS",
      summary: "Registrar venta ACID idempotente",
      requestSchema: CreateSaleSchema,
    },
    {
      path: "/api/sales/{id}",
      method: "delete",
      tag: "Ventas POS",
      summary: "Bloqueado (405 Method Not Allowed — libro contable inmutable)",
      responses: {
        "405": {
          description:
            "RFC 7807 Problem Details: el libro es append-only; usar POST /void",
        },
      },
    },
    {
      path: "/api/sales/{id}/void",
      method: "post",
      tag: "Ventas POS",
      summary: "Anular/devolver venta con contra-asiento contable atómico",
      requestSchema: VoidSaleSchema,
    },
    {
      path: "/api/sales/{id}/receipt.pdf",
      method: "get",
      tag: "Reportes",
      summary: "Recibo PDF del ticket",
    },
    {
      path: "/api/analytics",
      method: "get",
      tag: "Finanzas",
      summary: "KPIs, margen bruto, serie diaria y libro",
    },
    {
      path: "/api/exports/ledger.csv",
      method: "get",
      tag: "Reportes",
      summary: "Exportar libro contable CSV",
    },
    {
      path: "/api/exports/inventory.csv",
      method: "get",
      tag: "Reportes",
      summary: "Exportar inventario CSV",
    },
  ];

  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    const existing = paths[route.path] ?? {};
    existing[route.method] = {
      tags: [route.tag],
      summary: route.summary,
      ...(route.requestSchema
        ? {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: zodSchemaToJsonSchema(route.requestSchema),
                },
              },
            },
          }
        : {}),
      responses: route.responses ?? {
        "200": { description: "Operación exitosa" },
        "400": {
          description: "Error de validación (RFC 7807 Problem Details)",
        },
      },
    };
    paths[route.path] = existing;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "CajaLedger API",
      version: "2.0.0",
      description:
        "POS transaccional ACID en centavos enteros, control de inventario atómico, libro contable append-only con contra-asientos, sincronización offline-first e informes PDF/CSV.",
    },
    servers: [{ url: serverUrl }],
    paths,
  };
}

export function renderOpenApiDocsHtml(options: {
  title: string;
  specUrl: string;
}): string {
  const escapedTitle = options.title
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedTitle} — OpenAPI 3.1</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body style="margin:0;background:#09090b;color:#f4f4f5">
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.onload = function () {
        SwaggerUIBundle({ url: "${options.specUrl}", dom_id: "#swagger-ui" });
      };
    </script>
  </body>
</html>`;
}
