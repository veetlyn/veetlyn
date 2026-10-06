export function formatMinor(priceMinor: number, currency: string): string {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(priceMinor / 100);
}

// String-split parsing on purpose: Number("12.55") * 100 is 1254.999… and Math.round hides typos.
export function parsePriceInput(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}
