// Confirmation tokens for commitments a person makes with a widget button (program §3.4). The tool
// that renders the button returns a token in the result's _meta, which hosts give to the widget and
// not to the model; the commit tool refuses a call without a valid one. The state change itself makes
// a second use fail (a quote or a delivery is accepted once).
const encoder = new TextEncoder();
const LABEL = "payleor mcp confirmation v1";
const TTL_SECONDS = 15 * 60;

export type ConfirmationAction = "accept_quote" | "accept_delivery";

async function key(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const derived = await crypto.subtle.sign("HMAC", base, encoder.encode(LABEL));
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function message(input: { action: ConfirmationAction; userId: string; projectId: string; targetId: string }, exp: number) {
  return encoder.encode(`${input.action}:${input.userId}:${input.projectId}:${input.targetId}:${exp}`);
}

const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function issueConfirmation(
  secret: string,
  input: { action: ConfirmationAction; userId: string; projectId: string; targetId: string },
  now = Date.now(),
): Promise<string> {
  const exp = Math.floor(now / 1000) + TTL_SECONDS;
  const signature = await crypto.subtle.sign("HMAC", await key(secret), message(input, exp));
  return `${exp}.${toHex(signature)}`;
}

export async function verifyConfirmation(
  secret: string,
  token: string,
  input: { action: ConfirmationAction; userId: string; projectId: string; targetId: string },
  now = Date.now(),
): Promise<boolean> {
  const [expText, hex] = token.split(".");
  const exp = Number(expText);
  if (!Number.isSafeInteger(exp) || exp < Math.floor(now / 1000) || !hex || !/^[0-9a-f]{64}$/.test(hex)) return false;
  const signature = Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
  return crypto.subtle.verify("HMAC", await key(secret), signature, message(input, exp));
}
