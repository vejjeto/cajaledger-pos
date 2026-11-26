"use client";

import * as React from "react";

export function HealthBadge({
  endpoint = "/api/health",
}: { endpoint?: string }) {
  const [status, setStatus] = React.useState<"loading" | "ok" | "error">(
    "loading",
  );
  const [latency, setLatency] = React.useState<number | null>(null);

  React.useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const res = await fetch(endpoint, { cache: "no-store" });
        if (!res.ok) throw new Error("Health failed");
        const data = (await res.json()) as { dbLatencyMs?: number };
        if (!active) return;
        setStatus("ok");
        setLatency(
          typeof data.dbLatencyMs === "number" ? data.dbLatencyMs : null,
        );
      } catch {
        if (!active) return;
        setStatus("error");
      }
    };
    void check();
    const timer = setInterval(check, 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [endpoint]);

  const dotClass =
    status === "ok"
      ? "bg-emerald-500"
      : status === "error"
        ? "bg-rose-500"
        : "bg-amber-400 animate-pulse";

  return (
    <span
      title={
        status === "ok"
          ? "Base de datos SQLite operativa"
          : "Sin conexión con /api/health"
      }
      className="hidden h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 text-[11px] font-medium text-zinc-600 dark:border-zinc-800 dark:text-zinc-300 sm:inline-flex"
    >
      <span className={`h-2 w-2 rounded-full ${dotClass}`} />
      <span>
        {status === "ok" ? "ACID OK" : status === "error" ? "Offline" : "..."}
      </span>
      {latency !== null && (
        <span className="font-mono text-zinc-400">{latency}ms</span>
      )}
    </span>
  );
}
