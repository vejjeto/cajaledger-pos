"use client";

import { usePosStore } from "@/store/pos-store";
import { Command } from "lucide-react";
import * as React from "react";
import { UiModal } from "./modal";

export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const { setActiveTab } = usePosStore();

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const actions = [
    { label: "Ir a POS Caja", run: () => setActiveTab("pos") },
    { label: "Ir a Inventario", run: () => setActiveTab("inventory") },
    { label: "Ir a Finanzas & Libro", run: () => setActiveTab("finance") },
    {
      label: "Abrir API Docs (OpenAPI)",
      run: () => window.open("/api/docs", "_blank"),
    },
  ];

  return (
    <UiModal
      open={open}
      onOpenChange={setOpen}
      title="Paleta de Comandos (Ctrl/Cmd + K)"
      description="Navegación rápida en CajaLedger POS"
    >
      <div className="space-y-1.5">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => {
              action.run();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-left text-xs font-medium hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900"
          >
            <Command className="h-3.5 w-3.5 text-indigo-500" />
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    </UiModal>
  );
}
