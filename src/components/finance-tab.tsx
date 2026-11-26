"use client";

import { UiButton } from "@/components/ui/button";
import { UiModal } from "@/components/ui/modal";
import { useUiToast } from "@/components/ui/toast";
import type { SaleRecord } from "@/contracts/schemas";
import { formatCents } from "@/core/money";
import type { AnalyticsSummary } from "@/core/sales-service";
import { Download, FileText, RotateCcw, TrendingUp } from "lucide-react";
import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface FinanceTabProps {
  analytics: AnalyticsSummary | undefined;
  isLoading: boolean;
  onVoided?: () => Promise<void>;
}

export function FinanceTab({
  analytics,
  isLoading,
  onVoided,
}: FinanceTabProps) {
  const { pushToast } = useUiToast();
  const [mounted, setMounted] = React.useState(false);
  const [voidTarget, setVoidTarget] = React.useState<SaleRecord | null>(null);
  const [voidReason, setVoidReason] = React.useState("Devolución en caja");
  const [voiding, setVoiding] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const handleVoidSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidTarget) return;
    setVoiding(true);
    try {
      const res = await fetch(`/api/sales/${voidTarget.id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: voidReason }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { detail?: string };
        pushToast({
          title: "No se pudo anular la venta",
          description: err.detail ?? `HTTP ${res.status}`,
          variant: "error",
        });
        return;
      }
      pushToast({
        title: `Venta ${voidTarget.receiptNumber} anulada`,
        description: "Stock restaurado y contra-asiento emitido en el libro.",
        variant: "success",
      });
      setVoidTarget(null);
      setVoidReason("Devolución en caja");
      if (onVoided) await onVoided();
    } finally {
      setVoiding(false);
    }
  };

  if (isLoading || !analytics) {
    return (
      <div className="grid gap-4 md:grid-cols-4">
        {["k1", "k2", "k3", "k4"].map((id) => (
          <div
            key={id}
            className="h-28 animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
          />
        ))}
      </div>
    );
  }

  const chartData = analytics.dailySeries.map((point) => ({
    date: point.date.slice(5),
    Ingresos: Number((point.revenueCents / 100).toFixed(2)),
    Ganancia: Number((point.profitCents / 100).toFixed(2)),
    Gastos: Number((point.expenseCents / 100).toFixed(2)),
  }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/80">
          <p className="text-xs text-zinc-500">Ingresos Totales (IVA incl.)</p>
          <p className="mt-1 font-mono text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {formatCents(analytics.totalRevenueCents)}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {analytics.salesCount} ventas registradas
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/80">
          <p className="text-xs text-zinc-500">Ganancia Bruta</p>
          <p className="mt-1 font-mono text-2xl font-bold text-emerald-500">
            {formatCents(analytics.totalProfitCents)}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Margen Bruto:{" "}
            <span className="font-semibold">
              {analytics.grossMarginPercent}%
            </span>
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/80">
          <p className="text-xs text-zinc-500">Gastos / Restocks en Libro</p>
          <p className="mt-1 font-mono text-2xl font-bold text-rose-500">
            {formatCents(analytics.totalExpenseCents)}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Costo mercancía vendida: {formatCents(analytics.totalCostCents)}
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/80">
          <p className="text-xs text-zinc-500">Valoración Inventario (Costo)</p>
          <p className="mt-1 font-mono text-2xl font-bold text-indigo-500">
            {formatCents(analytics.inventoryValuationCostCents)}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Retail: {formatCents(analytics.inventoryValuationRetailCents)}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900/80">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-indigo-500" />
            <h3 className="text-sm font-semibold">
              Flujo Diario (Últimos 14 días)
            </h3>
          </div>
          <a
            href="/api/exports/ledger.csv"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar Libro Contable CSV
          </a>
        </div>

        <div className="h-72 w-full">
          {mounted ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#27272a"
                  opacity={0.35}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "#a1a1aa" }}
                />
                <YAxis tick={{ fontSize: 11, fill: "#a1a1aa" }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#09090b",
                    borderColor: "#27272a",
                    borderRadius: "10px",
                    fontSize: "12px",
                    color: "#f4f4f5",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Bar dataKey="Ingresos" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Ganancia" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Gastos" fill="#f43f5e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full w-full animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800/50" />
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/80">
          <h3 className="mb-3 text-sm font-semibold">
            Ventas Recientes & Recibos PDF
          </h3>
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {analytics.recentSales.map((sale) => (
              <div
                key={sale.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 px-3 py-2.5 text-xs dark:border-zinc-800"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-mono font-semibold">
                      {sale.receiptNumber}
                    </p>
                    {sale.status === "voided" && (
                      <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-400">
                        Anulada
                      </span>
                    )}
                  </div>
                  <p className="text-zinc-500">
                    {sale.createdAt.slice(0, 16).replace("T", " ")} ·{" "}
                    {sale.paymentMethod}
                    {sale.createdOfflineAt ? " · Sync Offline" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <p
                      className={`font-mono font-bold ${
                        sale.status === "voided"
                          ? "line-through text-zinc-500"
                          : ""
                      }`}
                    >
                      {formatCents(sale.totalCents)}
                    </p>
                    <p className="font-mono text-[11px] text-emerald-500">
                      +{formatCents(sale.profitCents)}
                    </p>
                  </div>
                  <a
                    href={`/api/sales/${sale.id}/receipt.pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-1.5 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    <FileText className="h-3.5 w-3.5 text-indigo-500" />
                    PDF
                  </a>
                  {sale.status !== "voided" && (
                    <button
                      type="button"
                      onClick={() => setVoidTarget(sale)}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 font-medium text-rose-400 hover:bg-rose-500/20"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Devolver / Anular
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/80">
          <h3 className="mb-3 text-sm font-semibold">
            Libro Contable (Ledger Inmutable)
          </h3>
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {analytics.ledger.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 px-3 py-2.5 text-xs dark:border-zinc-800"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{entry.description}</p>
                  <p className="text-zinc-500">
                    {entry.createdAt.slice(0, 16).replace("T", " ")} ·{" "}
                    {entry.category}
                  </p>
                </div>
                <span
                  className={`shrink-0 font-mono font-bold ${
                    entry.type === "income"
                      ? "text-emerald-500"
                      : "text-rose-500"
                  }`}
                >
                  {entry.type === "income" ? "+" : "-"}
                  {formatCents(entry.amountCents)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <UiModal
        open={Boolean(voidTarget)}
        onOpenChange={(open) => {
          if (!open) setVoidTarget(null);
        }}
        title={`Devolver / Anular ${voidTarget?.receiptNumber ?? ""}`}
        description="Emite un contra-asiento inmutable en el libro contable y restaura el stock atómicamente."
      >
        <form onSubmit={(e) => void handleVoidSale(e)} className="space-y-4">
          <div>
            <label
              htmlFor="void-reason"
              className="mb-1 block text-xs font-medium text-zinc-400"
            >
              Motivo de devolución / anulación
            </label>
            <input
              id="void-reason"
              type="text"
              required
              minLength={3}
              maxLength={200}
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              className="w-full rounded-xl border border-zinc-300 bg-transparent px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none dark:border-zinc-700"
            />
          </div>
          <div className="flex justify-end gap-2">
            <UiButton
              type="button"
              variant="secondary"
              onClick={() => setVoidTarget(null)}
            >
              Cancelar
            </UiButton>
            <UiButton type="submit" variant="danger" loading={voiding}>
              Confirmar Anulación
            </UiButton>
          </div>
        </form>
      </UiModal>
    </div>
  );
}
