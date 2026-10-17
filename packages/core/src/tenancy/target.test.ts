import { describe, expect, it } from "vitest";

import { parseRequestTarget } from "./target";

const SAME = { platformDomain: "payleor.app", storeDomain: "payleor.app" };
const SPLIT = { platformDomain: "payleor.app", storeDomain: "payleor.site" };
const parse = (hostname: string) => parseRequestTarget(hostname, SAME);
const parseSplit = (hostname: string) => parseRequestTarget(hostname, SPLIT);

describe("parseRequestTarget with one domain for platform and stores", () => {
  it("maps the apex domain to the www platform app", () => {
    expect(parse("payleor.app")).toEqual({ kind: "platform", app: "www" });
  });

  it.each([
    ["www.payleor.app", "www"],
    ["dash.payleor.app", "dash"],
    ["admin.payleor.app", "admin"],
    ["api.payleor.app", "api"],
    ["mcp.payleor.app", "mcp"],
  ] as const)("maps %s to the %s platform app", (hostname, app) => {
    expect(parse(hostname)).toEqual({ kind: "platform", app });
  });

  it("maps a store subdomain to a store", () => {
    expect(parse("acme.payleor.app")).toEqual({ kind: "store", slug: "acme" });
  });

  it.each(["store.payleor.app", "docs.payleor.app", "checkout.payleor.app"])(
    "returns unknown for the reserved subdomain %s",
    (hostname) => {
      expect(parse(hostname)).toEqual({ kind: "unknown" });
    },
  );

  it("returns unknown for nested subdomains", () => {
    expect(parse("a.b.payleor.app")).toEqual({ kind: "unknown" });
  });

  it("treats any other hostname as a custom domain", () => {
    expect(parse("Shop.Example.com")).toEqual({ kind: "custom-domain", hostname: "shop.example.com" });
  });

  it("ignores case, port and a trailing dot", () => {
    expect(parseRequestTarget("ACME.localhost:3001", { platformDomain: "localhost", storeDomain: "localhost" })).toEqual(
      { kind: "store", slug: "acme" },
    );
    expect(parse("acme.payleor.app.")).toEqual({ kind: "store", slug: "acme" });
  });

  it("treats labels named after built-in object properties as stores", () => {
    expect(parse("constructor.payleor.app")).toEqual({ kind: "store", slug: "constructor" });
    expect(parse("__proto__.payleor.app")).toEqual({ kind: "unknown" });
  });

  it("treats lookalike domains as custom domains, never as platform hosts", () => {
    expect(parse("evil-payleor.app")).toEqual({ kind: "custom-domain", hostname: "evil-payleor.app" });
    expect(parse("payleor.app.evil.com")).toEqual({ kind: "custom-domain", hostname: "payleor.app.evil.com" });
  });

  it("accepts bracketed IPv6 hosts with a port as custom domains", () => {
    expect(parse("[::1]:8787")).toEqual({ kind: "custom-domain", hostname: "[::1]" });
  });

  it.each(["", " ", "acme.payleor.app..", "shop_1.example.com", "a b.example.com"])(
    "returns unknown for the invalid hostname %j",
    (hostname) => {
      expect(parse(hostname)).toEqual({ kind: "unknown" });
    },
  );

  it("returns unknown when a configured domain is invalid", () => {
    expect(parseRequestTarget("acme.payleor.app", { platformDomain: "payleor.app", storeDomain: "" })).toEqual({
      kind: "unknown",
    });
  });
});

describe("parseRequestTarget with a separate store domain", () => {
  it("maps a subdomain of the store domain to a store", () => {
    expect(parseSplit("acme.payleor.site")).toEqual({ kind: "store", slug: "acme" });
  });

  it("keeps the platform apps on the platform domain", () => {
    expect(parseSplit("payleor.app")).toEqual({ kind: "platform", app: "www" });
    expect(parseSplit("dash.payleor.app")).toEqual({ kind: "platform", app: "dash" });
    expect(parseSplit("admin.payleor.app")).toEqual({ kind: "platform", app: "admin" });
  });

  it.each(["acme.payleor.app", "payleor.site", "a.b.payleor.site", "a.b.payleor.app", "admin.payleor.site"])(
    "returns unknown for %s",
    (hostname) => {
      expect(parseSplit(hostname)).toEqual({ kind: "unknown" });
    },
  );

  it("treats other hostnames as custom domains", () => {
    expect(parseSplit("shop.example.com")).toEqual({ kind: "custom-domain", hostname: "shop.example.com" });
  });
});
