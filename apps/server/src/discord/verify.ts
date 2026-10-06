// Discord signs every interaction request with Ed25519 over "<timestamp><raw body>" and hex-encodes
// signature and public key (Fact 1). workerd's Web Crypto supports Ed25519 (Fact 9).
const encoder = new TextEncoder();

const HEX_PATTERN = /^(?:[0-9a-f]{2})+$/i;

// The pattern check matters: Number.parseInt("1g", 16) is 1, so a per-pair parse alone would accept junk.
export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (!HEX_PATTERN.test(hex)) throw new Error("Not a hex string");
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

// Never throws: any malformed input is simply a request we cannot trust, so the caller answers 401.
export async function verifyDiscordSignature(
  publicKeyHex: string,
  timestamp: string,
  body: string,
  signatureHex: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", hexToBytes(publicKeyHex), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      hexToBytes(signatureHex),
      encoder.encode(timestamp + body),
    );
  } catch {
    return false;
  }
}
