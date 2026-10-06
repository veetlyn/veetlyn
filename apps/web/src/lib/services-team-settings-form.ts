import { percentToBps } from "@jendal-workspace/core";

export interface RateFieldValue {
  input: string;
  problem: string | null;
  bps: number | null;
}

// The settings form validates as the admin types; percentToBps accepts "," and a trailing "%".
export function rateField(input: string): RateFieldValue {
  if (!input.trim()) return { input, problem: "Enter a percent, like 20 or 2.5.", bps: null };
  const bps = percentToBps(input);
  if (bps === null) return { input, problem: "Use a number from 0 to 100, with at most two decimals.", bps: null };
  return { input, problem: null, bps };
}
