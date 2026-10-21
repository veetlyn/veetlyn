// Signed links. `/c/{token}` names one project and one of its client contacts at a link version (action
// catalog design §5.3); `/pay/{token}` names one payment and carries no amount (services spec §5.4). Both prove the bearer followed a link the team sent. The keys are derived from
// the Better Auth secret, so no new secret is needed, and each label separates its domain: a client token
// is never a pay token, and neither is ever a session token.
const encoder = new TextEncoder();

// Links sent before client contacts existed name only the project; they still verify under their own key.
const LEGACY_CLIENT_LINK_LABEL = "payleor client link v1";
const CLIENT_LINK_LABEL = "payleor client link v2";
// The same link handed to a signed-in client (their home, their AI) instead of emailed: it opens the page but
// proves no address.
const ACCOUNT_CLIENT_LINK_LABEL = "payleor client link v2 account";
const ACCOUNT_MARK = "a";
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

export type ClientLinkTarget = { projectId: string; contactId: string; version: number };

// A legacy link carries no contact: it stands for the project's primary contact at version 0. `emailed` says the
// link is one the server emails, so opening it can prove the address it went to.
export type VerifiedClientLink = { projectId: string; contactId: string | null; version: number; emailed: boolean };

const SEGMENT = /^[A-Za-z0-9-]+$/;
const VERSION = /^(0|[1-9][0-9]{0,8})$/;

export function signClientLink(secret: string, target: ClientLinkTarget): Promise<string> {
  return signLink(secret, CLIENT_LINK_LABEL, `${target.projectId}.${target.contactId}.${target.version}`);
}

export function signAccountClientLink(secret: string, target: ClientLinkTarget): Promise<string> {
  return signLink(secret, ACCOUNT_CLIENT_LINK_LABEL, `${target.projectId}.${target.contactId}.${target.version}.${ACCOUNT_MARK}`);
}

export function signLegacyClientLink(secret: string, projectId: string): Promise<string> {
  return signLink(secret, LEGACY_CLIENT_LINK_LABEL, projectId);
}

export async function verifyClientLink(secret: string, token: string): Promise<VerifiedClientLink | null> {
  const segments = token.split(".");
  if (segments.length === 2) {
    const projectId = await verifyLink(secret, LEGACY_CLIENT_LINK_LABEL, token);
    return projectId ? { projectId, contactId: null, version: 0, emailed: true } : null;
  }
  const [projectId, contactId, version, mark] = segments;
  const emailed = segments.length === 4;
  if (!emailed && (segments.length !== 5 || mark !== ACCOUNT_MARK)) return null;
  if (!projectId || !contactId || !version) return null;
  if (!SEGMENT.test(projectId) || !SEGMENT.test(contactId) || !VERSION.test(version)) return null;
  if (!(await verifyLink(secret, emailed ? CLIENT_LINK_LABEL : ACCOUNT_CLIENT_LINK_LABEL, token))) return null;
  return { projectId, contactId, version: Number(version), emailed };
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
