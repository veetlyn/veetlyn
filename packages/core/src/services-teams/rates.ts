import { MAX_RATE_BPS } from "./types";

// A whole percent with at most two decimals; "," is accepted as the decimal mark.
const PERCENT_PATTERN = /^(\d{1,3})(?:[.,](\d{1,2}))?$/;

export function percentToBps(input: string): number | null {
  const match = PERCENT_PATTERN.exec(input.trim().replace(/\s*%$/, ""));
  if (!match) return null;
  const [, whole = "", fraction = ""] = match;
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return bps <= MAX_RATE_BPS ? bps : null;
}

export function bpsToPercent(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const fraction = bps % 100;
  if (fraction === 0) return String(whole);
  return `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}
