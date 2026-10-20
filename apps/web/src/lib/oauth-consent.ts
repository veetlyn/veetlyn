// The host an OAuth client sends the person back to: the part of the client's identity it cannot choose freely,
// since tokens are only ever delivered there.
export function consentHost(redirectUri: string): string | null {
  try {
    const url = new URL(redirectUri);
    return url.protocol === "https:" || url.hostname === "localhost" ? url.host : null;
  } catch {
    return null;
  }
}

const SCOPE_LABELS = new Map([
  ["openid", "Know which Payleor account is yours"],
  ["profile", "See your name"],
  ["email", "See your email address"],
  ["offline_access", "Stay connected until you disconnect it"],
]);

export function scopeLabels(scopes: readonly string[]): string[] {
  return [...new Set(scopes.map((scope) => SCOPE_LABELS.get(scope) ?? `Use “${scope}”`))];
}
