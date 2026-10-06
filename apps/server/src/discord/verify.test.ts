import { describe, expect, it } from "vitest";

import { hexToBytes, verifyDiscordSignature } from "./verify";

const encoder = new TextEncoder();
const subtle = crypto.subtle;

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// @cloudflare/workers-types widens these results to CryptoKey | CryptoKeyPair and ArrayBuffer | JsonWebKey;
// an Ed25519 generateKey always yields a pair and a "raw" export always yields bytes.
async function generateKeyPair(): Promise<CryptoKeyPair> {
  return (await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
}

async function publicKeyHex(key: CryptoKey): Promise<string> {
  return toHex((await subtle.exportKey("raw", key)) as ArrayBuffer);
}

describe("verifyDiscordSignature", () => {
  it("accepts a signature made over the timestamp and the raw body, and rejects any edit", async () => {
    const keyPair = await generateKeyPair();
    const publicKey = await publicKeyHex(keyPair.publicKey);
    const timestamp = "1760000000";
    const body = JSON.stringify({ id: "1", token: "t", type: 1 });
    const signatureHex = toHex(
      await subtle.sign({ name: "Ed25519" }, keyPair.privateKey, encoder.encode(timestamp + body)),
    );

    await expect(verifyDiscordSignature(publicKey, timestamp, body, signatureHex)).resolves.toBe(true);
    await expect(verifyDiscordSignature(publicKey, timestamp, body + " ", signatureHex)).resolves.toBe(false);
    await expect(verifyDiscordSignature(publicKey, "1760000001", body, signatureHex)).resolves.toBe(false);
    // A 33-byte key is not a raw Ed25519 public key, so the import fails and the request is untrusted.
    await expect(verifyDiscordSignature(publicKey + "00", timestamp, body, signatureHex)).resolves.toBe(false);
  });

  it("rejects a valid signature from a different key", async () => {
    const signer = await generateKeyPair();
    const other = await generateKeyPair();
    const signatureHex = toHex(await subtle.sign({ name: "Ed25519" }, signer.privateKey, encoder.encode("1760000000{}")));

    await expect(
      verifyDiscordSignature(await publicKeyHex(other.publicKey), "1760000000", "{}", signatureHex),
    ).resolves.toBe(false);
  });

  it("treats malformed input as untrusted rather than an error", async () => {
    await expect(verifyDiscordSignature("not-hex", "1760000000", "{}", "nope")).resolves.toBe(false);
    await expect(verifyDiscordSignature("", "1760000000", "{}", "")).resolves.toBe(false);
    expect(() => hexToBytes("abc")).toThrow();
    expect(() => hexToBytes("1g")).toThrow();
    expect(hexToBytes("00ff")).toEqual(new Uint8Array([0, 255]));
  });
});
