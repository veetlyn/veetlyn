import { describe, expect, it } from "vitest";

import { hashToken, newToken } from "./tokens";

describe("tokens", () => {
  it("makes url-safe tokens of 43 characters that differ each time", () => {
    const a = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(a);
  });
  it("hashes to 64 hex characters, the same for the same token", async () => {
    const token = newToken();
    const hash = await hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    await expect(hashToken(token)).resolves.toBe(hash);
    await expect(hashToken(newToken())).resolves.not.toBe(hash);
  });
});
