import { formatMinor } from "./money";

export function priceLabel(offering: { priceMinMinor: number; priceMaxMinor: number }, currency: string): string {
  return offering.priceMinMinor === offering.priceMaxMinor
    ? formatMinor(offering.priceMinMinor, currency)
    : `${formatMinor(offering.priceMinMinor, currency)} – ${formatMinor(offering.priceMaxMinor, currency)}`;
}

export function daysLabel(offering: { daysMin: number; daysMax: number }): string {
  if (offering.daysMin !== offering.daysMax) return `${offering.daysMin}–${offering.daysMax} days`;
  return offering.daysMin === 1 ? "1 day" : `${offering.daysMin} days`;
}

export type Fulfilment = "people" | "automated" | "both";

export const FULFILMENT_LABELS = {
  people: "By people",
  automated: "Automated",
  both: "People + Automated",
} as const satisfies Record<Fulfilment, string>;
