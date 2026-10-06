// Signed client links (services spec §5.2): `/c/{token}` names one project and proves the bearer
// followed the link the team sent. The key is derived from the Better Auth secret, so no new secret
// is needed; it is domain-separated so a client token can never be a session token.
const encoder = new TextEncoder();

async function clientLinkKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const derived = await crypto.subtle.sign("HMAC", base, encoder.encode("payleor client link v1"));
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function base64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function unbase64url(text: string): Uint8Array {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export async function signClientLink(secret: string, projectId: string): Promise<string> {
  const key = await clientLinkKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(projectId));
  return `${projectId}.${base64url(signature)}`;
}

// The project id when the signature verifies, otherwise null. `subtle.verify` compares in constant time.
export async function verifyClientLink(secret: string, token: string): Promise<string | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const projectId = token.slice(0, dot);
  let signature: Uint8Array;
  try {
    signature = unbase64url(token.slice(dot + 1));
  } catch {
    return null;
  }
  const key = await clientLinkKey(secret);
  const ok = await crypto.subtle.verify("HMAC", key, signature as BufferSource, encoder.encode(projectId));
  return ok ? projectId : null;
}
