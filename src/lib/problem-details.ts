import { NextResponse } from "next/server";
import { getRequestId } from "./logger";

export interface ProblemDetailsOptions {
  status: number;
  title: string;
  detail: string;
  type?: string;
  instance?: string;
  code?: string;
  requestId?: string;
  errors?: unknown;
  headers?: Record<string, string>;
}

export function problemResponse(options: ProblemDetailsOptions): NextResponse {
  const requestId = options.requestId ?? getRequestId();
  const body = {
    type: options.type ?? `https://httpstatuses.com/${options.status}`,
    title: options.title,
    status: options.status,
    detail: options.detail,
    ...(options.instance ? { instance: options.instance } : {}),
    ...(options.code ? { code: options.code } : {}),
    requestId,
    ...(options.errors !== undefined ? { errors: options.errors } : {}),
  };

  return NextResponse.json(body, {
    status: options.status,
    headers: {
      "Content-Type": "application/problem+json",
      "x-request-id": requestId,
      ...options.headers,
    },
  });
}

export function jsonResponse<T>(
  data: T,
  options?: {
    status?: number;
    requestId?: string;
    headers?: Record<string, string>;
  },
): NextResponse<T> {
  const requestId = options?.requestId ?? getRequestId();
  return NextResponse.json(data, {
    status: options?.status ?? 200,
    headers: {
      "x-request-id": requestId,
      ...options?.headers,
    },
  });
}
