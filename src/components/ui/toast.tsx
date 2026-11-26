"use client";

import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import * as React from "react";

export interface ToastInput {
  title: string;
  description?: string;
  variant?: "success" | "error" | "info";
}

interface ToastItem extends ToastInput {
  id: string;
}

interface ToastContextValue {
  pushToast: (toast: ToastInput) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function UiToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  const pushToast = React.useCallback((toast: ToastInput) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ pushToast }}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0"
      >
        {toasts.map((t) => {
          const border =
            t.variant === "error"
              ? "border-rose-500/40 bg-zinc-950 text-rose-100"
              : t.variant === "success"
                ? "border-emerald-500/40 bg-zinc-950 text-emerald-100"
                : "border-indigo-500/40 bg-zinc-950 text-zinc-100";
          return (
            <div
              key={t.id}
              className={`flex items-start gap-2.5 rounded-xl border p-3 text-xs shadow-xl ${border}`}
            >
              {t.variant === "error" ? (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              ) : t.variant === "success" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              ) : (
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{t.title}</p>
                {t.description && (
                  <p className="mt-0.5 text-[11px] text-zinc-400">
                    {t.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                aria-label="Cerrar notificación"
                onClick={() =>
                  setToasts((prev) => prev.filter((item) => item.id !== t.id))
                }
                className="text-zinc-500 hover:text-zinc-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useUiToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error("useUiToast must be used within UiToastProvider");
  }
  return ctx;
}
