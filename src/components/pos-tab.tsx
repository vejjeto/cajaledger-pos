"use client";

import { UiButton } from "@/components/ui/button";
import { UiModal } from "@/components/ui/modal";
import { useUiToast } from "@/components/ui/toast";
import type {
  CreateSaleResult,
  PaymentMethod,
  ProductRecord,
} from "@/contracts/schemas";
import {
  DEFAULT_TAX_BPS,
  calculateSaleTotals,
  formatCents,
} from "@/core/money";
import type { OfflineQueueStore, PendingSaleRecord } from "@/core/offline-db";
import { useLocale } from "@/lib/i18n";
import { usePosStore } from "@/store/pos-store";
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  FileText,
  Landmark,
  Minus,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  WifiOff,
} from "lucide-react";
import * as React from "react";

interface PosTabProps {
  products: ProductRecord[];
  isLoading: boolean;
  isOffline: boolean;
  offlineStore: OfflineQueueStore;
  onRefreshPending: () => Promise<void>;
  onSaleCommitted: () => Promise<void>;
}

const PAYMENT_OPTIONS: readonly {
  value: PaymentMethod;
  label: string;
  icon: React.ReactNode;
}[] = [
  { value: "cash", label: "Efectivo", icon: <Banknote className="h-4 w-4" /> },
  { value: "card", label: "Tarjeta", icon: <CreditCard className="h-4 w-4" /> },
  {
    value: "transfer",
    label: "Transferencia",
    icon: <Landmark className="h-4 w-4" />,
  },
];

export function PosTab({
  products,
  isLoading,
  isOffline,
  offlineStore,
  onRefreshPending,
  onSaleCommitted,
}: PosTabProps) {
  const { t } = useLocale();
  const { pushToast } = useUiToast();
  const {
    cart,
    paymentMethod,
    setPaymentMethod,
    addToCart,
    updateQty,
    removeFromCart,
    clearCart,
  } = usePosStore();

  const [search, setSearch] = React.useState("");
  const [category, setCategory] = React.useState("Todas");
  const [submitting, setSubmitting] = React.useState(false);
  const [lastReceipt, setLastReceipt] = React.useState<CreateSaleResult | null>(
    null,
  );
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const categories = React.useMemo(() => {
    const unique = Array.from(new Set(products.map((p) => p.category))).sort();
    return ["Todas", ...unique];
  }, [products]);

  const filteredProducts = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (category !== "Todas" && p.category !== category) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [products, category, search]);

  const totals = React.useMemo(() => {
    if (cart.length === 0) {
      return {
        subtotalCents: 0,
        taxCents: 0,
        totalCents: 0,
        totalCostCents: 0,
        profitCents: 0,
        grossMarginPercent: 0,
      };
    }
    return calculateSaleTotals(
      cart.map((c) => ({
        quantity: c.quantity,
        unitPriceCents: c.unitPriceCents,
        unitCostCents: c.unitCostCents,
      })),
      DEFAULT_TAX_BPS,
    );
  }, [cart]);

  const handleCheckout = React.useCallback(async () => {
    if (cart.length === 0 || submitting) return;
    setSubmitting(true);
    const idempotencyKey = crypto.randomUUID();

    try {
      if (isOffline) {
        const record: PendingSaleRecord = {
          id: crypto.randomUUID(),
          idempotencyKey,
          paymentMethod,
          taxBps: DEFAULT_TAX_BPS,
          createdOfflineAt: new Date().toISOString(),
          totalCents: totals.totalCents,
          status: "pending",
          attempts: 0,
          items: cart.map((c) => ({
            productId: c.productId,
            productName: c.name,
            quantity: c.quantity,
            unitPriceCents: c.unitPriceCents,
          })),
        };
        await offlineStore.enqueue(record);
        await onRefreshPending();
        clearCart();
        pushToast({
          title: "Venta guardada en cola offline (Dexie)",
          description: `Total ${formatCents(totals.totalCents)} · Se sincronizará FIFO al volver la red`,
          variant: "info",
        });
        return;
      }

      const res = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey,
          paymentMethod,
          taxBps: DEFAULT_TAX_BPS,
          items: cart.map((c) => ({
            productId: c.productId,
            quantity: c.quantity,
          })),
        }),
      });

      if (!res.ok) {
        const errBody = (await res.json()) as { error?: string };
        pushToast({
          title: "No se pudo completar la venta",
          description: errBody.error ?? `HTTP ${res.status}`,
          variant: "error",
        });
        return;
      }

      const result = (await res.json()) as CreateSaleResult;
      clearCart();
      setLastReceipt(result);
      await onSaleCommitted();
      pushToast({
        title: `Venta ${result.sale.receiptNumber} registrada`,
        description: `Cobro ACID por ${formatCents(result.sale.totalCents)}`,
        variant: "success",
      });
    } catch {
      const record: PendingSaleRecord = {
        id: crypto.randomUUID(),
        idempotencyKey,
        paymentMethod,
        taxBps: DEFAULT_TAX_BPS,
        createdOfflineAt: new Date().toISOString(),
        totalCents: totals.totalCents,
        status: "pending",
        attempts: 0,
        items: cart.map((c) => ({
          productId: c.productId,
          productName: c.name,
          quantity: c.quantity,
          unitPriceCents: c.unitPriceCents,
        })),
      };
      await offlineStore.enqueue(record);
      await onRefreshPending();
      clearCart();
      pushToast({
        title: "Sin conexión · Guardado en IndexedDB",
        description: "La venta quedó protegida en cola FIFO offline.",
        variant: "info",
      });
    } finally {
      setSubmitting(false);
    }
  }, [
    cart,
    submitting,
    isOffline,
    paymentMethod,
    totals.totalCents,
    offlineStore,
    onRefreshPending,
    clearCart,
    pushToast,
    onSaleCommitted,
  ]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (event.key === "F2") {
        event.preventDefault();
        void handleCheckout();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleCheckout]);

  const handleSearchKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Enter") {
      const topMatch = filteredProducts.find((p) => p.stock > 0);
      if (topMatch) {
        event.preventDefault();
        addToCart(topMatch);
      }
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              ref={searchInputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Buscar producto o SKU... (atajo: / · Enter agrega el primero)"
              className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-9 pr-4 text-sm text-zinc-900 outline-none transition focus:border-indigo-500 dark:border-zinc-800 dark:bg-zinc-900/90 dark:text-zinc-100"
            />
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  category === cat
                    ? "bg-indigo-600 text-white"
                    : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {["s1", "s2", "s3", "s4", "s5", "s6"].map((id) => (
              <div
                key={id}
                className="h-32 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
              />
            ))}
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-800">
            Sin productos que coincidan con &ldquo;{search}&rdquo;.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filteredProducts.map((product) => {
              const outOfStock = product.stock <= 0;
              const lowStock = !outOfStock && product.stock <= product.minStock;
              const inCartQty =
                cart.find((c) => c.productId === product.id)?.quantity ?? 0;

              return (
                <button
                  key={product.id}
                  type="button"
                  disabled={outOfStock}
                  onClick={() => addToCart(product)}
                  className="group flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-4 text-left transition hover:border-indigo-500/60 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900/70 dark:hover:bg-zinc-900"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        {product.sku}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          outOfStock
                            ? "bg-rose-500/15 text-rose-500"
                            : lowStock
                              ? "bg-amber-500/15 text-amber-500"
                              : "bg-emerald-500/15 text-emerald-500"
                        }`}
                      >
                        {outOfStock ? "Agotado" : `${product.stock} uds`}
                      </span>
                    </div>
                    <h3 className="line-clamp-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {product.name}
                    </h3>
                    <p className="text-xs text-zinc-500">{product.category}</p>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-2.5 dark:border-zinc-800">
                    <span className="font-mono text-base font-bold text-indigo-600 dark:text-indigo-400">
                      {formatCents(product.priceCents)}
                    </span>
                    {inCartQty > 0 ? (
                      <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                        {inCartQty} en caja
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-400 group-hover:text-indigo-400">
                        + Agregar
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <aside className="flex h-fit flex-col rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/90">
        <div className="flex items-center justify-between border-b border-zinc-200 pb-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-indigo-500" />
            <h2 className="text-sm font-semibold">Ticket Actual</h2>
          </div>
          {cart.length > 0 && (
            <button
              type="button"
              onClick={clearCart}
              className="text-xs text-zinc-500 hover:text-rose-500"
            >
              Vaciar
            </button>
          )}
        </div>

        <div className="my-3 max-h-72 space-y-2.5 overflow-y-auto pr-1">
          {cart.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 py-10 text-center text-xs text-zinc-500 dark:border-zinc-800">
              Selecciona productos o presiona{" "}
              <kbd className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">/</kbd>{" "}
              para buscar.
            </div>
          ) : (
            cart.map((item) => (
              <div
                key={item.productId}
                className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50/70 p-2.5 dark:border-zinc-800 dark:bg-zinc-950/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{item.name}</p>
                  <p className="font-mono text-[11px] text-zinc-500">
                    {formatCents(item.unitPriceCents)} × {item.quantity} ={" "}
                    <span className="font-semibold text-zinc-900 dark:text-zinc-200">
                      {formatCents(item.unitPriceCents * item.quantity)}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Disminuir cantidad"
                    onClick={() => updateQty(item.productId, -1)}
                    className="rounded-md border border-zinc-300 p-1 hover:bg-zinc-200 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="w-6 text-center font-mono text-xs font-semibold">
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    aria-label="Aumentar cantidad"
                    onClick={() => updateQty(item.productId, 1)}
                    disabled={item.quantity >= item.maxStock}
                    className="rounded-md border border-zinc-300 p-1 hover:bg-zinc-200 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    aria-label="Quitar producto"
                    onClick={() => removeFromCart(item.productId)}
                    className="ml-1 rounded-md p-1 text-zinc-400 hover:text-rose-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="space-y-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              {t.paymentMethod}
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {PAYMENT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPaymentMethod(opt.value)}
                  className={`flex flex-col items-center gap-1 rounded-lg border py-2 text-[11px] font-medium transition ${
                    paymentMethod === opt.value
                      ? "border-indigo-500 bg-indigo-500/10 text-indigo-500 dark:text-indigo-400"
                      : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  }`}
                >
                  {opt.icon}
                  <span>{t[opt.value]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5 rounded-xl bg-zinc-100/80 p-3 text-xs dark:bg-zinc-950/80">
            <div className="flex justify-between text-zinc-500">
              <span>{t.subtotal}</span>
              <span className="font-mono">
                {formatCents(totals.subtotalCents)}
              </span>
            </div>
            <div className="flex justify-between text-zinc-500">
              <span>{t.tax}</span>
              <span className="font-mono">{formatCents(totals.taxCents)}</span>
            </div>
            <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
              <span>{t.estGrossMargin}</span>
              <span className="font-mono">
                {formatCents(totals.profitCents)} ({totals.grossMarginPercent}%)
              </span>
            </div>
            <div className="flex justify-between border-t border-zinc-200 pt-2 text-base font-bold dark:border-zinc-800">
              <span>{t.total}</span>
              <span className="font-mono text-indigo-600 dark:text-indigo-400">
                {formatCents(totals.totalCents)}
              </span>
            </div>
          </div>

          <UiButton
            type="button"
            size="lg"
            loading={submitting}
            disabled={cart.length === 0}
            onClick={() => void handleCheckout()}
            className="w-full"
          >
            {isOffline ? (
              <>
                <WifiOff className="h-4 w-4" />
                {t.saveOfflineSale}
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                {t.chargeSale}
              </>
            )}
          </UiButton>
        </div>
      </aside>

      <UiModal
        open={Boolean(lastReceipt)}
        onOpenChange={(open) => {
          if (!open) setLastReceipt(null);
        }}
        title={
          lastReceipt ? `Recibo ${lastReceipt.sale.receiptNumber}` : "Recibo"
        }
        description="Transacción ACID confirmada con clave de idempotencia"
      >
        {lastReceipt && (
          <div className="space-y-4 text-sm">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs dark:border-zinc-800 dark:bg-zinc-900">
              <p>Total cobrado: {formatCents(lastReceipt.sale.totalCents)}</p>
              <p className="text-emerald-500">
                Ganancia bruta: {formatCents(lastReceipt.sale.profitCents)}
              </p>
              <p className="mt-1 truncate text-zinc-500">
                Idempotency: {lastReceipt.sale.idempotencyKey}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <UiButton
                variant="secondary"
                onClick={() => setLastReceipt(null)}
              >
                Cerrar
              </UiButton>
              <a
                href={`/api/sales/${lastReceipt.sale.id}/receipt.pdf`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-500"
              >
                <FileText className="h-4 w-4" />
                Abrir Recibo PDF
              </a>
            </div>
          </div>
        )}
      </UiModal>
    </div>
  );
}
