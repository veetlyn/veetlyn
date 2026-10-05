import { describe, expect, it } from "vitest";

import { hashRecipient } from "./email-log";

describe("hashRecipient", () => {
  it("gives the same 16-character hex hash whatever the case or spacing", async () => {
    const hash = await hashRecipient("Ada@Example.com ");

    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    await expect(hashRecipient("ada@example.com")).resolves.toBe(hash);
  });

  it("gives different hashes for different addresses and never contains the address", async () => {
    const hash = await hashRecipient("ada@example.com");

    await expect(hashRecipient("bob@example.com")).resolves.not.toBe(hash);
    expect(hash).not.toContain("ada");
  });
});
