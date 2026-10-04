import { describe, expect, it } from "vitest";

import { validateStoreSlug } from "./slug";

describe("validateStoreSlug", () => {
  it("accepts lowercase letters, digits and single hyphens", () => {
    expect(validateStoreSlug("acme-shop-2")).toEqual({ ok: true, slug: "acme-shop-2" });
  });

  it("trims and lowercases the input", () => {
    expect(validateStoreSlug("  Acme ")).toEqual({ ok: true, slug: "acme" });
  });

  it.each(["ab", "-acme", "acme-", "acme_shop", "a--b", "acme.shop", "a".repeat(41)])(
    "rejects %s as a format error",
    (input) => {
      expect(validateStoreSlug(input)).toEqual({ ok: false, reason: "format" });
    },
  );

  // Host labels, then the admin's own top-level paths (spec §4.2).
  it.each([
    "www",
    "admin",
    "api",
    "mcp",
    "store",
    "app",
    "docs",
    "login",
    "signup",
    "logout",
    "account",
    "settings",
    "orgs",
    "new",
    "verify-email",
    "forgot-password",
    "reset-password",
    "trpc",
    "assets",
    "static",
  ])("rejects reserved slug %s", (input) => {
    expect(validateStoreSlug(input)).toEqual({ ok: false, reason: "reserved" });
  });
});
