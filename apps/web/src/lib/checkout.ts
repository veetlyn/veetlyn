export type GrantState = "usable" | "used_up" | "expired" | "revoked";

export function grantMessage(state: GrantState, status: "paid" | "refunded" | "pending"): string | null {
  if (status === "refunded" || state === "revoked") return "This order was refunded, so the download is no longer available.";
  if (state === "expired") return "This link has expired. Ask for a new one and we'll email it to you.";
  if (state === "used_up") return "This link has no downloads left. Ask for a new one and we'll email it to you.";
  return null;
}

// Mirrors the server's token input bounds, so a mangled link reads as invalid without a request
// that would fail validation with a technical message.
export function orderTokenLooksValid(token: string): boolean {
  return token.length >= 20 && token.length <= 100;
}

export function downloadsLeftLabel(downloadsLeft: number): string {
  return downloadsLeft === 1 ? "1 download left" : `${downloadsLeft} downloads left`;
}
