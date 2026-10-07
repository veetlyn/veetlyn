import { describe, expect, it } from "vitest";

import { signClientLink, signPayLink, verifyClientLink, verifyPayLink } from "./client-links";

const SECRET = "test-secret-that-is-at-least-32-characters";

describe("client links", () => {
  it("round-trips a project id", async () => {
    const token = await signClientLink(SECRET, "proj-123");
    expect(token.startsWith("proj-123.")).toBe(true);
    await expect(verifyClientLink(SECRET, token)).resolves.toBe("proj-123");
  });

  it("rejects forged, truncated and foreign tokens", async () => {
    const token = await signClientLink(SECRET, "proj-123");
    await expect(verifyClientLink(SECRET, token.replace("proj-123", "proj-999"))).resolves.toBeNull();
    await expect(verifyClientLink(SECRET, token.slice(0, -4))).resolves.toBeNull();
    await expect(verifyClientLink("another-secret-that-is-at-least-32-chars", token)).resolves.toBeNull();
    await expect(verifyClientLink(SECRET, "")).resolves.toBeNull();
    await expect(verifyClientLink(SECRET, "proj-123.!!!not-base64!!!")).resolves.toBeNull();
  });
});

describe("pay links", () => {
  it("round-trips a payment id", async () => {
    const token = await signPayLink(SECRET, "payment-1");
    expect(await verifyPayLink(SECRET, token)).toBe("payment-1");
  });

  it("never accepts a client link as a pay link, or a pay link as a client link", async () => {
    expect(await verifyPayLink(SECRET, await signClientLink(SECRET, "id-1"))).toBeNull();
    expect(await verifyClientLink(SECRET, await signPayLink(SECRET, "id-1"))).toBeNull();
  });

  it("rejects a tampered pay link", async () => {
    const token = await signPayLink(SECRET, "payment-1");
    expect(await verifyPayLink(SECRET, token.replace("payment-1", "payment-2"))).toBeNull();
  });
});
