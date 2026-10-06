import { describe, expect, it } from "vitest";

import { signClientLink, verifyClientLink } from "./client-links";

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
