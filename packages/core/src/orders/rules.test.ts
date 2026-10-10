import { describe, expect, it } from "vitest";

import {
  DOWNLOAD_GRANT_DAYS,
  DOWNLOADS_PER_GRANT,
  buyerEmailProblem,
  grantState,
  orderCustomId,
  orderIdFromCustomId,
} from "./rules";

const now = new Date("2026-10-10T12:00:00Z");
const grant = { downloadsLeft: 5, expiresAt: new Date("2026-10-17T12:00:00Z"), revokedAt: null };

describe("download grants", () => {
  it("lasts 7 days and 5 downloads", () => {
    expect(DOWNLOAD_GRANT_DAYS).toBe(7);
    expect(DOWNLOADS_PER_GRANT).toBe(5);
  });
  it("is usable with downloads left before it expires", () => {
    expect(grantState(grant, now)).toBe("usable");
  });
  it("is used up at zero downloads", () => {
    expect(grantState({ ...grant, downloadsLeft: 0 }, now)).toBe("used_up");
  });
  it("expires at its expiry time", () => {
    expect(grantState(grant, new Date("2026-10-17T12:00:00Z"))).toBe("expired");
  });
  it("revoked wins over everything", () => {
    expect(grantState({ ...grant, revokedAt: now }, now)).toBe("revoked");
  });
});

describe("buyer email", () => {
  it("accepts a normal address after trimming", () => {
    expect(buyerEmailProblem("  jo@example.com ")).toBeNull();
  });
  it("refuses a malformed or long address", () => {
    expect(buyerEmailProblem("jo@")).toBe("That email address does not look right.");
    expect(buyerEmailProblem(`${"a".repeat(320)}@example.com`)).toBe("That email address does not look right.");
  });
});

describe("custom ids", () => {
  it("round-trips an order id", () => {
    const id = "6f1c2f3e-1b2a-4c5d-8e9f-0a1b2c3d4e5f";
    expect(orderCustomId(id)).toBe(`order:${id}`);
    expect(orderIdFromCustomId(`order:${id}`)).toBe(id);
  });
  it("is null for a payment id, a malformed value or null", () => {
    expect(orderIdFromCustomId("6f1c2f3e-1b2a-4c5d-8e9f-0a1b2c3d4e5f")).toBeNull();
    expect(orderIdFromCustomId("order:nope")).toBeNull();
    expect(orderIdFromCustomId(null)).toBeNull();
  });
});
