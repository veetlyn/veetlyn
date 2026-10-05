import { describe, expect, it } from "vitest";

import { validateStoreSlug } from "./slug";

describe("validateStoreSlug", () => {
  it("accepts lowercase letters, digits and single hyphens", () => {
    expect(validateStoreSlug("acme-shop-2")).toEqual({ ok: true, slug: "acme-shop-2" });
  });

  it("trims and lowercases the input", () => {
    expect(validateStoreSlug("  Acme ")).toEqual({ ok: true, slug: "acme" });
  });

  it.each(["abc", "a".repeat(40)])("accepts %s at the length limits", (input) => {
    expect(validateStoreSlug(input)).toEqual({ ok: true, slug: input });
  });

  it.each(["ab", "-acme", "acme-", "acme_shop", "a--b", "acme.shop", "a".repeat(41)])(
    "rejects %s as a format error",
    (input) => {
      expect(validateStoreSlug(input)).toEqual({ ok: false, reason: "format" });
    },
  );

  // Spec §4.2: host labels, environments, mail and DNS, trust and brands, agents, then the admin's own paths.
  it.each([
    "www",
    "admin",
    "api",
    "mcp",
    "store",
    "shop",
    "app",
    "docs",
    "mail",
    "status",
    "help",
    "support",
    "blog",
    "cdn",
    "dashboard",
    "auth",
    "oauth",
    "checkout",
    "pay",
    "payments",
    "billing",
    "dev",
    "staging",
    "preview",
    "sandbox",
    "test",
    "demo",
    "email",
    "smtp",
    "imap",
    "autodiscover",
    "autoconfig",
    "ns1",
    "ns2",
    "security",
    "abuse",
    "payleor",
    "paypal",
    "venmo",
    "braintree",
    "agent",
    "agents",
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
