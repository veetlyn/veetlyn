// Signed links. `/c/{token}` names one project (services spec §5.2); `/pay/{token}` names one payment and
// carries no amount (§5.4). Both prove the bearer followed a link the team sent. The keys are derived from
// the Better Auth secret, so no new secret is needed, and each label separates its domain: a client token
// is never a pay token, and neither is ever a session token.
const encoder = new TextEncoder();

const CLIENT_LINK_LABEL = "payleor client link v1";
const PAY_LINK_LABEL = "payleor pay link v1";

async function linkKey(secret: string, label: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const derived = await crypto.subtle.sign("HMAC", base, encoder.encode(label));
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function base64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function unbase64url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function signLink(secret: string, label: string, id: string): Promise<string> {
  const key = await linkKey(secret, label);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(id));
  return `${id}.${base64url(signature)}`;
}

// The id when the signature verifies, otherwise null. `subtle.verify` compares in constant time.
async function verifyLink(secret: string, label: string, token: string): Promise<string | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  let signature: Uint8Array<ArrayBuffer>;
  try {
    signature = unbase64url(token.slice(dot + 1));
  } catch {
    return null;
  }
  const key = await linkKey(secret, label);
  const ok = await crypto.subtle.verify("HMAC", key, signature, encoder.encode(id));
  return ok ? id : null;
}

export function signClientLink(secret: string, projectId: string): Promise<string> {
  return signLink(secret, CLIENT_LINK_LABEL, projectId);
}

export function verifyClientLink(secret: string, token: string): Promise<string | null> {
  return verifyLink(secret, CLIENT_LINK_LABEL, token);
}

export function signPayLink(secret: string, paymentId: string): Promise<string> {
  return signLink(secret, PAY_LINK_LABEL, paymentId);
}

export function verifyPayLink(secret: string, token: string): Promise<string | null> {
  return verifyLink(secret, PAY_LINK_LABEL, token);
}

// The links are signed with the Better Auth secret.
export type LinkSecretSource = { options: { secret?: string } };

export function linkSecret(auth: LinkSecretSource): string {
  const secret = auth.options.secret;
  if (!secret) {
    throw new Error("The link secret (BETTER_AUTH_SECRET) is not configured.");
  }
  return secret;
}
