import { randomUUID } from "node:crypto";
import pino from "pino";

const level =
  process.env.LOG_LEVEL ??
  (process.env.NODE_ENV === "test" ? "silent" : "info");

export const logger = pino({
  name: "cajaledger-pos",
  level,
  redact: {
    paths: [
      "password",
      "token",
      "secret",
      "apiKey",
      "authorization",
      "*.password",
      "*.token",
      "*.secret",
      "*.apiKey",
      "*.authorization",
      "headers.authorization",
      "headers.cookie",
    ],
    censor: "[REDACTED]",
  },
  base: {
    service: "cajaledger-pos",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function getRequestId(request?: Request): string {
  const headerId = request?.headers.get("x-request-id")?.trim();
  return headerId && headerId.length > 0 ? headerId : randomUUID();
}

export function getRequestLogger(request?: Request) {
  const requestId = getRequestId(request);
  return {
    requestId,
    log: logger.child({ requestId }),
  };
}
