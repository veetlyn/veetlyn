import { describe, expect, it } from "vitest";

import { storeSlugProblem, suggestStoreSlug, teamSlugProblem, validateStoreSlug } from "./slug";

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
    "platform",
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

  it("can never produce the freelancer portal's /me path", () => {
    expect(validateStoreSlug("me")).toEqual({ ok: false, reason: "format" });
    expect(validateStoreSlug(" ME ")).toEqual({ ok: false, reason: "format" });
  });
});

describe("suggestStoreSlug", () => {
  it.each([
    ["Acme Goods", "acme-goods"],
    ["  Café Noël!  ", "cafe-noel"],
    ["Bob's  Bikes & Boards", "bob-s-bikes-boards"],
    ["Shop #2", "shop-2"],
  ])("turns %j into %j", (name, slug) => {
    expect(suggestStoreSlug(name)).toBe(slug);
  });

  it("adds -store to reserved or too-short results", () => {
    expect(suggestStoreSlug("Demo")).toBe("demo-store");
    expect(suggestStoreSlug("Login")).toBe("login-store");
    expect(suggestStoreSlug("AB")).toBe("ab-store");
  });

  it("returns an empty string when nothing usable is left", () => {
    expect(suggestStoreSlug("   ")).toBe("");
    expect(suggestStoreSlug("日本の店")).toBe("");
  });

  it("keeps long names within 40 characters and valid", () => {
    const slug = suggestStoreSlug("The Very Long Name Of A Store That Sells Many Things");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(validateStoreSlug(slug)).toEqual({ ok: true, slug });
  });
});

describe("storeSlugProblem", () => {
  it("explains each problem in plain words", () => {
    expect(storeSlugProblem("format")).toBe("Use 3 to 40 lowercase letters, numbers or single hyphens.");
    expect(storeSlugProblem("reserved")).toBe("This store address is reserved.");
    expect(storeSlugProblem("taken")).toBe("This store address is already taken.");
  });
});

describe("teamSlugProblem", () => {
  it("speaks of a store address for stores", () => {
    expect(teamSlugProblem("reserved", "store")).toBe("This store address is reserved.");
    expect(teamSlugProblem("taken", "store")).toBe("This store address is already taken.");
  });

  it("speaks of a team address for services teams", () => {
    expect(teamSlugProblem("reserved", "services")).toBe("This team address is reserved.");
    expect(teamSlugProblem("taken", "services")).toBe("This team address is already taken.");
  });

  it("explains the format the same way for both", () => {
    expect(teamSlugProblem("format", "services")).toBe(storeSlugProblem("format"));
  });
});
