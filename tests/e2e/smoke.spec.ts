import { expect, test } from "@playwright/test";

test("CajaLedger POS, Offline Toggle & Inventory smoke flow", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("CajaLedger")).toBeVisible();
  await expect(page.getByText("Cargador GaN 65W USB-C")).toBeVisible();

  await page.getByText("Simular corte de internet").click();
  await expect(page.getByText("Corte simulado (Offline)")).toBeVisible();

  await page.getByText("Cargador GaN 65W USB-C").click();
  await page.getByRole("button", { name: /Guardar Venta Offline/i }).click();
  await expect(page.getByText("Cola: 1")).toBeVisible();

  await page.getByText("Corte simulado (Offline)").click();
  await expect(page.getByText("Cola: 0")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Inventario" }).click();
  await expect(page.getByText("TECH-USB-C65")).toBeVisible();

  await page.getByRole("button", { name: "Finanzas & Libro" }).click();
  await expect(page.getByText("Flujo Diario")).toBeVisible();
});
