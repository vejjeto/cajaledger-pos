"use client";

import { UiButton } from "@/components/ui/button";
import { HealthBadge } from "@/components/ui/health-badge";
import { useUiToast } from "@/components/ui/toast";
import type { ProductRecord } from "@/contracts/schemas";
import { type PendingSaleRecord, getOfflineStore } from "@/core/offline-db";
import { syncPendingSales } from "@/core/offline-sync";
import type { AnalyticsSummary } from "@/core/sales-service";
import { type ActiveTab, usePosStore } from "@/store/pos-store";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Boxes,
  CloudOff,
  FileCode2,
  Moon,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  Sun,
  Wifi,
  WifiOff,
} from "lucide-react";
import * as React from "react";
import { FinanceTab } from "./finance-tab";
import { InventoryTab } from "./inventory-tab";
import { OfflineDrawer } from "./offline-drawer";
import { PosTab } from "./pos-tab";

export function CajaShell() {
  const queryClient = useQueryClient();
  const { pushToast } = useUiToast();
  const {
    activeTab,
    setActiveTab,
    simulateOffline,
    setSimulateOffline,
    browserOnline,
    setBrowserOnline,
  } = usePosStore();

  const offlineStore = React.useMemo(() => getOfflineStore(), []);
  const [pendingSales, setPendingSales] = React.useState<PendingSaleRecord[]>(
    [],
  );
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);

  const isEffectiveOffline = simulateOffline || !browserOnline;

  const refreshPending = React.useCallback(async () => {
    const items = await offlineStore.listPending();
    setPendingSales(items);
  }, [offlineStore]);

  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: async (): Promise<ProductRecord[]> => {
      try {
        const res = await fetch("/api/products");
        if (!res.ok) throw new Error("Failed products fetch");
        const data = (await res.json()) as { products: ProductRecord[] };
        setBrowserOnline(true);
        await offlineStore.cacheProducts(data.products);
        return data.products;
      } catch {
        return offlineStore.getCachedProducts();
      }
    },
  });

  const analyticsQuery = useQuery({
    queryKey: ["analytics"],
    queryFn: async (): Promise<AnalyticsSummary> => {
      const res = await fetch("/api/analytics");
      if (!res.ok) throw new Error("Failed analytics fetch");
      return (await res.json()) as AnalyticsSummary;
    },
  });

  const invalidateData = React.useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["products"] }),
      queryClient.invalidateQueries({ queryKey: ["analytics"] }),
    ]);
  }, [queryClient]);

  const runSync = React.useCallback(async () => {
    if (syncing || isEffectiveOffline) return;
    const current = await offlineStore.listPending();
    if (current.length === 0) return;

    setSyncing(true);
    try {
      const summary = await syncPendingSales(offlineStore);
      await refreshPending();
      if (summary.syncedCount > 0) {
        await invalidateData();
        pushToast({
          title: `Sincronización FIFO completada (${summary.syncedCount})`,
          description:
            summary.conflictCount > 0
              ? `${summary.conflictCount} venta(s) requieren resolución de conflicto.`
              : "Todas las ventas offline se registraron con ACID.",
          variant: summary.conflictCount > 0 ? "info" : "success",
        });
      } else if (summary.conflictCount > 0) {
        setDrawerOpen(true);
        pushToast({
          title: `Conflicto 409 en ${summary.conflictCount} venta(s) offline`,
          description: "Revisa el stock disponible en la cola de conflictos.",
          variant: "error",
        });
      }
    } finally {
      setSyncing(false);
    }
  }, [
    syncing,
    isEffectiveOffline,
    offlineStore,
    refreshPending,
    invalidateData,
    pushToast,
  ]);

  React.useEffect(() => {
    void refreshPending();

    const onOnline = () => {
      setBrowserOnline(true);
    };
    const onOffline = () => {
      setBrowserOnline(false);
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [refreshPending, setBrowserOnline]);

  React.useEffect(() => {
    if (!isEffectiveOffline) {
      void runSync();
    }
  }, [isEffectiveOffline, runSync]);

  const toggleTheme = () => {
    const root = document.documentElement;
    const nextDark = !root.classList.contains("dark");
    root.classList.toggle("dark", nextDark);
    try {
      localStorage.setItem("theme", nextDark ? "dark" : "light");
    } catch {
      // Ignore storage error
    }
  };

  const openDemoBusiness = async () => {
    setActiveTab("pos");
    await invalidateData();
    pushToast({
      title: "Negocio Demo listo",
      description: "15 productos y 14 días de historial contable activos.",
      variant: "success",
    });
  };

  const conflictCount = pendingSales.filter(
    (s) => s.status === "conflict",
  ).length;

  const tabs: { id: ActiveTab; label: string; icon: React.ReactNode }[] = [
    { id: "pos", label: "POS Caja", icon: <ShoppingBag className="h-4 w-4" /> },
    {
      id: "inventory",
      label: "Inventario",
      icon: <Boxes className="h-4 w-4" />,
    },
    {
      id: "finance",
      label: "Finanzas & Libro",
      icon: <BookOpen className="h-4 w-4" />,
    },
  ];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/85 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/85">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 font-mono text-sm font-bold text-white shadow-sm">
              CL
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight">
                  CajaLedger
                </h1>
                <span className="hidden rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold text-indigo-500 sm:inline">
                  ACID · Centavos · Offline-First
                </span>
              </div>
              <p className="text-[11px] text-zinc-500">
                POS transaccional con idempotencia &amp; libro contable
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <UiButton
              size="sm"
              variant="secondary"
              onClick={() => void openDemoBusiness()}
            >
              <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
              Abrir Negocio Demo
            </UiButton>

            <button
              type="button"
              onClick={() => setSimulateOffline(!simulateOffline)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition ${
                isEffectiveOffline
                  ? "border-amber-500/50 bg-amber-500/15 text-amber-500"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
              }`}
            >
              {isEffectiveOffline ? (
                <>
                  <WifiOff className="h-3.5 w-3.5" />
                  Corte simulado (Offline)
                </>
              ) : (
                <>
                  <Wifi className="h-3.5 w-3.5" />
                  Simular corte de internet
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition ${
                conflictCount > 0
                  ? "border-rose-500/50 bg-rose-500/15 text-rose-400"
                  : pendingSales.length > 0
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                    : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
              }`}
            >
              {syncing ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CloudOff className="h-3.5 w-3.5" />
              )}
              <span>Cola: {pendingSales.length}</span>
              {conflictCount > 0 && (
                <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {conflictCount} conflicto
                </span>
              )}
            </button>

            <HealthBadge endpoint="/api/health" />

            <a
              href="/api/docs"
              target="_blank"
              rel="noreferrer"
              className="hidden h-8 items-center gap-1 rounded-lg border border-zinc-200 px-2.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900 md:inline-flex"
            >
              <FileCode2 className="h-3.5 w-3.5 text-indigo-400" />
              API Docs
            </a>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Cambiar tema claro u oscuro"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              <Sun className="h-4 w-4 dark:hidden" />
              <Moon className="hidden h-4 w-4 dark:inline" />
            </button>
          </div>
        </div>

        <nav className="mx-auto flex max-w-7xl items-center gap-1 px-4 pb-2 sm:px-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                activeTab === tab.id
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 pb-16 sm:px-6">
        {activeTab === "pos" && (
          <PosTab
            products={productsQuery.data ?? []}
            isLoading={productsQuery.isLoading}
            isOffline={isEffectiveOffline}
            offlineStore={offlineStore}
            onRefreshPending={refreshPending}
            onSaleCommitted={invalidateData}
          />
        )}

        {activeTab === "inventory" && (
          <InventoryTab
            products={productsQuery.data ?? []}
            onUpdated={invalidateData}
          />
        )}

        {activeTab === "finance" && (
          <FinanceTab
            analytics={analyticsQuery.data}
            isLoading={analyticsQuery.isLoading}
            onVoided={invalidateData}
          />
        )}
      </main>

      <OfflineDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        pendingSales={pendingSales}
        isOffline={isEffectiveOffline}
        syncing={syncing}
        offlineStore={offlineStore}
        onSyncNow={runSync}
        onRefreshPending={refreshPending}
      />
    </div>
  );
}
