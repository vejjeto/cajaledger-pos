import * as React from "react";

export type Locale = "es" | "en";

export const LANG_STORAGE_KEY = "cajaledger-lang";
export const LANG_EVENT = "cajaledger-lang-change";

export const translations = {
  es: {
    subtitle: "POS transaccional con idempotencia & libro contable",
    openDemo: "Abrir Negocio Demo",
    simulateOffline: "Simular corte de internet",
    simulatedOffline: "Corte simulado (Offline)",
    queue: "Cola",
    conflict: "conflicto",
    apiDocs: "API Docs",
    toggleThemeAria: "Cambiar tema claro u oscuro",
    tabPos: "POS Caja",
    tabInventory: "Inventario",
    tabFinance: "Finanzas & Libro",
    paymentMethod: "Método de pago",
    cash: "Efectivo",
    card: "Tarjeta",
    transfer: "Transferencia",
    subtotal: "Subtotal",
    tax: "IVA (16%)",
    estGrossMargin: "Margen bruto est.",
    total: "Total",
    saveOfflineSale: "Guardar Venta Offline (F2)",
    chargeSale: "Cobrar Venta (F2)",
    filterPlaceholder: "Filtrar inventario por SKU, nombre o categoría...",
    exportCsv: "Exportar CSV",
    newProduct: "Nuevo Producto",
    restock: "Reabastecer",
    dailyFlow: "Flujo Diario (Últimos 14 días)",
    exportLedgerCsv: "Exportar Libro Contable CSV",
    recentSales: "Ventas Recientes & Recibos PDF",
    voidSale: "Devolver / Anular",
    ledgerTitle: "Libro Contable (Ledger Inmutable)",
  },
  en: {
    subtitle: "Transactional POS with idempotency & accounting ledger",
    openDemo: "Open Demo Business",
    simulateOffline: "Simulate network outage",
    simulatedOffline: "Simulated outage (Offline)",
    queue: "Queue",
    conflict: "conflict",
    apiDocs: "API Docs",
    toggleThemeAria: "Toggle light or dark theme",
    tabPos: "POS Register",
    tabInventory: "Inventory",
    tabFinance: "Finance & Ledger",
    paymentMethod: "Payment method",
    cash: "Cash",
    card: "Card",
    transfer: "Transfer",
    subtotal: "Subtotal",
    tax: "VAT (16%)",
    estGrossMargin: "Est. gross margin",
    total: "Total",
    saveOfflineSale: "Save Offline Sale (F2)",
    chargeSale: "Charge Sale (F2)",
    filterPlaceholder: "Filter inventory by SKU, name or category...",
    exportCsv: "Export CSV",
    newProduct: "New Product",
    restock: "Restock",
    dailyFlow: "Daily Flow (Last 14 days)",
    exportLedgerCsv: "Export Accounting Ledger CSV",
    recentSales: "Recent Sales & PDF Receipts",
    voidSale: "Refund / Void",
    ledgerTitle: "Accounting Ledger (Immutable)",
  },
} as const satisfies Record<Locale, Record<string, string>>;

export type TranslationDictionary = (typeof translations)[Locale];

function isLocale(value: unknown): value is Locale {
  return value === "es" || value === "en";
}

function readStoredLocale(): Locale {
  try {
    const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
    return isLocale(saved) ? saved : "es";
  } catch {
    return "es";
  }
}

export function useLocale() {
  const [locale, setLocaleState] = React.useState<Locale>("es");

  React.useEffect(() => {
    const initial = readStoredLocale();
    setLocaleState(initial);
    document.documentElement.lang = initial;

    const onLangEvent = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (isLocale(detail)) {
        setLocaleState(detail);
        document.documentElement.lang = detail;
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === LANG_STORAGE_KEY && isLocale(event.newValue)) {
        setLocaleState(event.newValue);
        document.documentElement.lang = event.newValue;
      }
    };

    window.addEventListener(LANG_EVENT, onLangEvent);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(LANG_EVENT, onLangEvent);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setLocale = React.useCallback((next: Locale) => {
    setLocaleState(next);
    document.documentElement.lang = next;
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      // Ignore storage error
    }
    window.dispatchEvent(new CustomEvent<Locale>(LANG_EVENT, { detail: next }));
  }, []);

  const toggleLocale = React.useCallback(() => {
    setLocale(locale === "es" ? "en" : "es");
  }, [locale, setLocale]);

  return {
    locale,
    setLocale,
    toggleLocale,
    t: translations[locale],
  };
}
