export type MoneyCurrency = "USD" | "EUR";

export const MONEY_CURRENCIES = ["USD", "EUR"] as const satisfies readonly MoneyCurrency[];

// Integer minor units (cents). Ledger entries may be negative; prices and payments never are.
export type Money = { readonly currency: MoneyCurrency; readonly minor: number };

// One billion in major units. Forms and use cases reject larger amounts.
export const MAX_AMOUNT_MINOR = 100_000_000_000;

export function assertMinor(value: number, label = "amount"): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a whole number of minor units, got ${value}`);
  }
}

export function assertAmount(value: number, label = "amount"): void {
  assertMinor(value, label);
  if (value < 0) throw new RangeError(`${label} cannot be negative, got ${value}`);
}

export function assertBps(value: number, label = "rate"): void {
  assertMinor(value, label);
  if (value < 0 || value > 10_000) throw new RangeError(`${label} must be between 0 and 10000 basis points, got ${value}`);
}

export function money(currency: MoneyCurrency, minor: number): Money {
  assertMinor(minor);
  return { currency, minor };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new Error(`Currency mismatch: ${a.currency} and ${b.currency}`);
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.currency, a.minor + b.minor);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.currency, a.minor - b.minor);
}

// Basis points of a non-negative amount, rounded half-up once (services spec §5.3).
// BigInt keeps the product exact for any amount up to MAX_AMOUNT_MINOR.
export function bpsOf(minor: number, bps: number): number {
  assertAmount(minor);
  assertAmount(bps, "rate");
  return Number((BigInt(minor) * BigInt(bps) + 5_000n) / 10_000n);
}

const formatters = new Map<MoneyCurrency, Intl.NumberFormat>();

// USD and EUR both have two decimals, so minor / 100 is exact for display.
export function formatMoney(value: Money): string {
  let formatter = formatters.get(value.currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: value.currency });
    formatters.set(value.currency, formatter);
  }
  return formatter.format(value.minor / 100);
}

// "1,000.50" or "1000.5" in major units to minor units; null unless it is a positive amount
// with at most two decimals and at most MAX_AMOUNT_MINOR.
export function parseMajorAmount(input: string): number | null {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(input.trim().replace(/,/g, ""));
  if (!match) return null;
  const minor = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return minor > 0 && minor <= MAX_AMOUNT_MINOR ? minor : null;
}
