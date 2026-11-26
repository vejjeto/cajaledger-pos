export const DEFAULT_TAX_BPS = 1600; // 16.00% IVA

export function assertIntegerCents(value: number, label = "amount"): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `${label} must be a safe integer in cents, got ${value}`,
    );
  }
  return value;
}

export function assertNonNegativeCents(
  value: number,
  label = "amount",
): number {
  assertIntegerCents(value, label);
  if (value < 0) {
    throw new RangeError(`${label} must be >= 0 cents, got ${value}`);
  }
  return value;
}

export function calculateTaxCents(
  subtotalCents: number,
  taxBps = DEFAULT_TAX_BPS,
): number {
  assertNonNegativeCents(subtotalCents, "subtotalCents");
  assertNonNegativeCents(taxBps, "taxBps");
  return Math.round((subtotalCents * taxBps) / 10000);
}

export interface PricedLineInput {
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
}

export interface SaleTotals {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  totalCostCents: number;
  profitCents: number;
  grossMarginPercent: number;
}

export function calculateGrossMarginPercent(
  revenueCents: number,
  costCents: number,
): number {
  assertIntegerCents(revenueCents, "revenueCents");
  assertIntegerCents(costCents, "costCents");
  if (revenueCents <= 0) return 0;
  const raw = ((revenueCents - costCents) / revenueCents) * 100;
  return Number(raw.toFixed(2));
}

export function calculateSaleTotals(
  lines: readonly PricedLineInput[],
  taxBps = DEFAULT_TAX_BPS,
): SaleTotals {
  let subtotalCents = 0;
  let totalCostCents = 0;

  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      throw new RangeError(
        `quantity must be a positive integer, got ${line.quantity}`,
      );
    }
    assertNonNegativeCents(line.unitPriceCents, "unitPriceCents");
    assertNonNegativeCents(line.unitCostCents, "unitCostCents");
    subtotalCents += line.unitPriceCents * line.quantity;
    totalCostCents += line.unitCostCents * line.quantity;
  }

  const taxCents = calculateTaxCents(subtotalCents, taxBps);
  const totalCents = subtotalCents + taxCents;
  // Gross profit compares pre-tax revenue against COGS; tax is pass-through.
  const profitCents = subtotalCents - totalCostCents;
  const grossMarginPercent = calculateGrossMarginPercent(
    subtotalCents,
    totalCostCents,
  );

  return {
    subtotalCents,
    taxCents,
    totalCents,
    totalCostCents,
    profitCents,
    grossMarginPercent,
  };
}

const currencyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCents(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  return currencyFormatter.format(safe / 100);
}
