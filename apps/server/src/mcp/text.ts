// Sellers write offering names, descriptions, team names, quotes and messages; the model reads them. Each such
// string is framed as quoted data, stripped of control characters and capped, so it cannot pass for Payleor's
// own instructions (security audit B2).
// oxlint-disable-next-line no-control-regex -- matching control characters is the point.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g;

export function plain(value: string, max: number): string {
  const flat = value.replace(CONTROL, "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export function quoted(value: string, max = 120): string {
  return `«${plain(value, max).replace(/[«»]/g, '"')}»`;
}

export const money = (minor: number, currency: string): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);

export const daysLabel = (min: number, max: number): string => (min === max ? `${min} days` : `${min}–${max} days`);
