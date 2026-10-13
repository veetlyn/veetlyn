import { describe, expect, it } from "vitest";

import { importSecretKey, openSecret, sealSecret } from "./secret-box";

function base64Key(fill: number, length = 32): string {
  return btoa(String.fromCharCode(...new Uint8Array(length).fill(fill)));
}

describe("secret box", () => {
  it("opens what it sealed, under the same key and context", async () => {
    const key = await importSecretKey(base64Key(1));
    const sealed = await sealSecret(key, "v1", "team-client-secret", "team-1");

    expect(sealed.keyId).toBe("v1");
    expect(atob(sealed.ciphertext)).not.toContain("team-client-secret");
    await expect(openSecret(key, sealed, "team-1")).resolves.toBe("team-client-secret");
  });

  it("refuses to open a secret under another team's context or another key", async () => {
    const key = await importSecretKey(base64Key(1));
    const otherKey = await importSecretKey(base64Key(2));
    const sealed = await sealSecret(key, "v1", "team-client-secret", "team-1");

    await expect(openSecret(key, sealed, "team-2")).rejects.toThrow();
    await expect(openSecret(otherKey, sealed, "team-1")).rejects.toThrow();
  });

  it("uses a fresh IV for every seal", async () => {
    const key = await importSecretKey(base64Key(1));
    const first = await sealSecret(key, "v1", "same", "team-1");
    const second = await sealSecret(key, "v1", "same", "team-1");

    expect(second.iv).not.toBe(first.iv);
    expect(second.ciphertext).not.toBe(first.ciphertext);
  });

  it("refuses a key that is not 32 bytes of base64", async () => {
    await expect(importSecretKey(base64Key(1, 16))).rejects.toThrow("32 bytes, not 16");
    await expect(importSecretKey("not base64!")).rejects.toThrow("not valid base64");
  });
});
