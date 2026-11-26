import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().min(1).default("file:./data/cajaledger.db"),
  POSTGRES_URL: z.string().url().optional().or(z.literal("")),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3009"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  SKIP_ENV_VALIDATION: z.string().optional(),
});

export type AppEnv = z.infer<typeof EnvSchema>;

export function parseEnv(
  raw: Record<string, string | undefined> = process.env,
  options?: { forceValidate?: boolean },
): AppEnv {
  const skip = !options?.forceValidate && raw.SKIP_ENV_VALIDATION === "true";
  if (skip) {
    return {
      NODE_ENV: (raw.NODE_ENV as AppEnv["NODE_ENV"]) ?? "development",
      DATABASE_URL: raw.DATABASE_URL || "file:./data/cajaledger.db",
      POSTGRES_URL: raw.POSTGRES_URL ?? "",
      NEXT_PUBLIC_APP_URL: raw.NEXT_PUBLIC_APP_URL || "http://localhost:3009",
      LOG_LEVEL: (raw.LOG_LEVEL as AppEnv["LOG_LEVEL"]) ?? "info",
      SKIP_ENV_VALIDATION: raw.SKIP_ENV_VALIDATION,
    };
  }

  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const formatted = JSON.stringify(parsed.error.flatten().fieldErrors);
    throw new Error(`Invalid environment configuration: ${formatted}`);
  }
  return parsed.data;
}

let cachedEnv: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (!cachedEnv) {
    cachedEnv = parseEnv(process.env);
  }
  return cachedEnv;
}
