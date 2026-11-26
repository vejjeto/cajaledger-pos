"use client";

import { UiButton } from "@/components/ui/button";
import { UiModal } from "@/components/ui/modal";
import { useUiToast } from "@/components/ui/toast";
import type { ProductRecord } from "@/contracts/schemas";
import { calculateGrossMarginPercent, formatCents } from "@/core/money";
import { useLocale } from "@/lib/i18n";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown, Download, PackagePlus, PlusCircle } from "lucide-react";
import * as React from "react";

interface InventoryTabProps {
  products: ProductRecord[];
  onUpdated: () => Promise<void>;
}

export function InventoryTab({ products, onUpdated }: InventoryTabProps) {
  const { pushToast } = useUiToast();
  const { t } = useLocale();
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState("");

  const [restockTarget, setRestockTarget] =
    React.useState<ProductRecord | null>(null);
  const [restockQty, setRestockQty] = React.useState("10");
  const [restockNote, setRestockNote] = React.useState("");
  const [savingRestock, setSavingRestock] = React.useState(false);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [sku, setSku] = React.useState("");
  const [name, setName] = React.useState("");
  const [category, setCategory] = React.useState("Accesorios");
  const [costPesos, setCostPesos] = React.useState("150.00");
  const [pricePesos, setPricePesos] = React.useState("299.00");
  const [stock, setStock] = React.useState("10");
  const [savingCreate, setSavingCreate] = React.useState(false);

  const columns = React.useMemo<ColumnDef<ProductRecord>[]>(
    () => [
      {
        accessorKey: "sku",
        header: "SKU",
        cell: (info) => (
          <span className="font-mono text-xs text-zinc-500">
            {String(info.getValue())}
          </span>
        ),
      },
      {
        accessorKey: "name",
        header: "Producto",
        cell: (info) => (
          <span className="font-medium">{String(info.getValue())}</span>
        ),
      },
      {
        accessorKey: "category",
        header: "Categoría",
        cell: (info) => (
          <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
            {String(info.getValue())}
          </span>
        ),
      },
      {
        accessorKey: "costCents",
        header: "Costo",
        cell: (info) => (
          <span className="font-mono text-xs text-zinc-500">
            {formatCents(Number(info.getValue()))}
          </span>
        ),
      },
      {
        accessorKey: "priceCents",
        header: "Precio",
        cell: (info) => (
          <span className="font-mono text-xs font-semibold">
            {formatCents(Number(info.getValue()))}
          </span>
        ),
      },
      {
        id: "margin",
        header: "Margen",
        accessorFn: (row) =>
          calculateGrossMarginPercent(row.priceCents, row.costCents),
        cell: (info) => (
          <span className="font-mono text-xs text-emerald-500">
            {String(info.getValue())}%
          </span>
        ),
      },
      {
        accessorKey: "stock",
        header: "Stock",
        cell: ({ row }) => {
          const item = row.original;
          const low = item.stock <= item.minStock;
          return (
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-xs font-semibold ${
                item.stock === 0
                  ? "bg-rose-500/15 text-rose-500"
                  : low
                    ? "bg-amber-500/15 text-amber-500"
                    : "bg-emerald-500/15 text-emerald-500"
              }`}
            >
              {item.stock} / mín {item.minStock}
            </span>
          );
        },
      },
      {
        id: "actions",
        header: "Acción",
        enableSorting: false,
        cell: ({ row }) => (
          <UiButton
            size="sm"
            variant="outline"
            onClick={() => {
              setRestockTarget(row.original);
              setRestockQty("10");
              setRestockNote("");
            }}
          >
            <PackagePlus className="h-3.5 w-3.5" />
            {t.restock}
          </UiButton>
        ),
      },
    ],
    [t.restock],
  );

  const table = useReactTable({
    data: products,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const submitRestock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restockTarget) return;
    const qty = Number.parseInt(restockQty, 10);
    if (!Number.isInteger(qty) || qty <= 0) {
      pushToast({ title: "Cantidad inválida", variant: "error" });
      return;
    }

    setSavingRestock(true);
    try {
      const res = await fetch(`/api/products/${restockTarget.id}/restock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity: qty,
          note: restockNote || undefined,
          recordExpense: true,
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        pushToast({
          title: body.error ?? "Error en restock",
          variant: "error",
        });
        return;
      }
      setRestockTarget(null);
      await onUpdated();
      pushToast({
        title: `Stock actualizado (+${qty})`,
        description: `${restockTarget.name} reabastecido y registrado en libro contable.`,
        variant: "success",
      });
    } finally {
      setSavingRestock(false);
    }
  };

  const submitNewProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const costCents = Math.round(Number.parseFloat(costPesos) * 100);
    const priceCents = Math.round(Number.parseFloat(pricePesos) * 100);
    const initialStock = Number.parseInt(stock, 10);

    setSavingCreate(true);
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku,
          name,
          category,
          costCents,
          priceCents,
          stock: initialStock,
          minStock: 5,
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        pushToast({
          title: body.error ?? "No se pudo crear producto",
          variant: "error",
        });
        return;
      }
      setCreateOpen(false);
      setSku("");
      setName("");
      await onUpdated();
      pushToast({ title: "Producto agregado al catálogo", variant: "success" });
    } finally {
      setSavingCreate(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder={t.filterPlaceholder}
          className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-800 dark:bg-zinc-900"
        />
        <div className="flex items-center gap-2">
          <a
            href="/api/exports/inventory.csv"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-300 px-3 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <Download className="h-3.5 w-3.5" />
            {t.exportCsv}
          </a>
          <UiButton size="md" onClick={() => setCreateOpen(true)}>
            <PlusCircle className="h-4 w-4" />
            {t.newProduct}
          </UiButton>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-zinc-100/80 text-xs uppercase tracking-wider text-zinc-600 dark:bg-zinc-900/90 dark:text-zinc-400">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th key={header.id} className="px-4 py-3 font-medium">
                    {header.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-white"
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        <ArrowUpDown className="h-3 w-3 opacity-60" />
                      </button>
                    ) : (
                      flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-zinc-200 bg-white dark:divide-zinc-800/80 dark:bg-zinc-950/60">
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <UiModal
        open={Boolean(restockTarget)}
        onOpenChange={(open) => {
          if (!open) setRestockTarget(null);
        }}
        title={
          restockTarget ? `Reabastecer: ${restockTarget.name}` : "Reabastecer"
        }
        description="Actualiza stock atómicamente y registra movimiento + gasto contable"
      >
        <form onSubmit={submitRestock} className="space-y-3">
          <div>
            <label
              htmlFor="restock-qty"
              className="mb-1 block text-xs font-medium"
            >
              Unidades a ingresar
            </label>
            <input
              id="restock-qty"
              type="number"
              min={1}
              required
              value={restockQty}
              onChange={(e) => setRestockQty(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
            />
          </div>
          <div>
            <label
              htmlFor="restock-note"
              className="mb-1 block text-xs font-medium"
            >
              Nota / Factura proveedor (opcional)
            </label>
            <input
              id="restock-note"
              value={restockNote}
              onChange={(e) => setRestockNote(e.target.value)}
              placeholder="Ej. Orden #FAC-204"
              className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <UiButton
              type="button"
              variant="secondary"
              onClick={() => setRestockTarget(null)}
            >
              Cancelar
            </UiButton>
            <UiButton type="submit" loading={savingRestock}>
              Confirmar Restock
            </UiButton>
          </div>
        </form>
      </UiModal>

      <UiModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Nuevo Producto en Catálogo"
        description="Los precios y costos se convierten internamente a centavos enteros"
      >
        <form onSubmit={submitNewProduct} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="prod-sku"
                className="mb-1 block text-xs font-medium"
              >
                SKU
              </label>
              <input
                id="prod-sku"
                required
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="TECH-NEW-01"
                className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
              />
            </div>
            <div>
              <label
                htmlFor="prod-category"
                className="mb-1 block text-xs font-medium"
              >
                Categoría
              </label>
              <input
                id="prod-category"
                required
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="prod-name"
              className="mb-1 block text-xs font-medium"
            >
              Nombre del producto
            </label>
            <input
              id="prod-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Adaptador DisplayPort 4K"
              className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="prod-cost"
                className="mb-1 block text-xs font-medium"
              >
                Costo ($)
              </label>
              <input
                id="prod-cost"
                type="number"
                step="0.01"
                min="0"
                required
                value={costPesos}
                onChange={(e) => setCostPesos(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
              />
            </div>
            <div>
              <label
                htmlFor="prod-price"
                className="mb-1 block text-xs font-medium"
              >
                Precio ($)
              </label>
              <input
                id="prod-price"
                type="number"
                step="0.01"
                min="0"
                required
                value={pricePesos}
                onChange={(e) => setPricePesos(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
              />
            </div>
            <div>
              <label
                htmlFor="prod-stock"
                className="mb-1 block text-xs font-medium"
              >
                Stock inicial
              </label>
              <input
                id="prod-stock"
                type="number"
                min="0"
                required
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <UiButton
              type="button"
              variant="secondary"
              onClick={() => setCreateOpen(false)}
            >
              Cancelar
            </UiButton>
            <UiButton type="submit" loading={savingCreate}>
              Guardar Producto
            </UiButton>
          </div>
        </form>
      </UiModal>
    </div>
  );
}
