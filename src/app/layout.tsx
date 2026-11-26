import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "CajaLedger — ACID POS, Inventario & Libro Contable Offline-First",
  description:
    "Punto de venta ACID en centavos enteros, control atómico de inventario, cola offline Dexie.js con resolución de conflictos y reportes PDF/CSV.",
};

const ZERO_FOUC_SCRIPT = `
(function() {
  try {
    var saved = localStorage.getItem('theme') || localStorage.getItem('forge-theme');
    if (saved === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static zero-FOUC theme bootstrap */}
        <script dangerouslySetInnerHTML={{ __html: ZERO_FOUC_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
