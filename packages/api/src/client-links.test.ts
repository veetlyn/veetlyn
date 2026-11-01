import { afterEach, describe, expect, it, vi } from "vitest";

import { signAccountClientLink, signClientLink, signLegacyClientLink, signPayLink, verifyClientLink, verifyPayLink } from "./client-links";

const SECRET = "test-secret-that-is-at-least-32-characters";
const TARGET = { projectId: "proj-123", contactId: "contact-1", version: 2 };

describe("client links", () => {
  it("round-trips a project, a contact and a link version", async () => {
    const token = await signClientLink(SECRET, TARGET);
    await expect(verifyClientLink(SECRET, token)).resolves.toEqual({ ...TARGET, emailed: true });
  });

  it("rejects a token with any segment changed, truncated, or signed with another secret", async () => {
    const token = await signClientLink(SECRET, TARGET);
    await expect(verifyClientLink(SECRET, token.replace("proj-123", "proj-999"))).resolves.toBeNull();
    await expect(verifyClientLink(SECRET, token.replace("contact-1", "contact-2"))).resolves.toBeNull();
    await expect(verifyClientLink(SECRET, token.replace(".2.", ".3."))).resolves.toBeNull();
    await expect(verifyClientLink(SECRET, token.slice(0, -4))).resolves.toBeNull();
    await expect(verifyClientLink("another-secret-that-is-at-least-32-chars", token)).resolves.toBeNull();
    await expect(verifyClientLink(SECRET, "")).resolves.toBeNull();
    await expect(verifyClientLink(SECRET, "proj-123.contact-1.2.!!!not-base64!!!")).resolves.toBeNull();
  });

  it("still accepts links sent before contacts, as the primary contact at version 0", async () => {
    const legacy = await signLegacyClientLink(SECRET, "proj-123");
    await expect(verifyClientLink(SECRET, legacy)).resolves.toEqual({ projectId: "proj-123", contactId: null, version: 0, emailed: true });
    await expect(verifyClientLink(SECRET, legacy.replace("proj-123", "proj-999"))).resolves.toBeNull();
  });
});

describe("account client links", () => {
  afterEach(() => vi.useRealTimers());

  it("open the page for an hour without proving an address, then stop", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-01T10:00:00Z") });
    const token = await signAccountClientLink(SECRET, TARGET);
    await expect(verifyClientLink(SECRET, token)).resolves.toEqual({ ...TARGET, emailed: false });
    vi.setSystemTime(new Date("2026-11-01T11:00:00Z"));
    await expect(verifyClientLink(SECRET, token)).resolves.toBeNull();
  });

  it("rejects a later expiry written into the token", async () => {
    const token = await signAccountClientLink(SECRET, TARGET);
    const [projectId, contactId, version, mark, signature] = token.split(".");
    const later = `a${Number(mark?.slice(1)) + 86_400}`;
    await expect(verifyClientLink(SECRET, [projectId, contactId, version, later, signature].join("."))).resolves.toBeNull();
  });
});

describe("pay links", () => {
  it("round-trips a payment id", async () => {
    const token = await signPayLink(SECRET, "payment-1");
    expect(await verifyPayLink(SECRET, token)).toBe("payment-1");
  });

  it("never accepts a client link as a pay link, or a pay link as a client link", async () => {
    expect(await verifyPayLink(SECRET, await signLegacyClientLink(SECRET, "id-1"))).toBeNull();
    expect(await verifyPayLink(SECRET, await signClientLink(SECRET, TARGET))).toBeNull();
    expect(await verifyClientLink(SECRET, await signPayLink(SECRET, "id-1"))).toBeNull();
  });

  it("rejects a tampered pay link", async () => {
    const token = await signPayLink(SECRET, "payment-1");
    expect(await verifyPayLink(SECRET, token.replace("payment-1", "payment-2"))).toBeNull();
  });
});
