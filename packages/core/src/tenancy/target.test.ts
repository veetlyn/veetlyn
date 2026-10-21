import { describe, expect, it } from "vitest";

import { parseRequestTarget } from "./target";

const SAME = { platformDomain: "platform.test", storeDomain: "platform.test" };
const SPLIT = { platformDomain: "platform.test", storeDomain: "stores.test" };
const parse = (hostname: string) => parseRequestTarget(hostname, SAME);
const parseSplit = (hostname: string) => parseRequestTarget(hostname, SPLIT);

describe("parseRequestTarget with one domain for platform and stores", () => {
  it("maps the apex domain to the www platform app", () => {
    expect(parse("platform.test")).toEqual({ kind: "platform", app: "www" });
  });

  it.each([
    ["www.platform.test", "www"],
    ["dash.platform.test", "dash"],
    ["admin.platform.test", "admin"],
    ["api.platform.test", "api"],
    ["mcp.platform.test", "mcp"],
  ] as const)("maps %s to the %s platform app", (hostname, app) => {
    expect(parse(hostname)).toEqual({ kind: "platform", app });
  });

  it("maps a store subdomain to a store", () => {
    expect(parse("acme.platform.test")).toEqual({ kind: "store", slug: "acme" });
  });

  it.each(["store.platform.test", "docs.platform.test", "checkout.platform.test"])(
    "returns unknown for the reserved subdomain %s",
    (hostname) => {
      expect(parse(hostname)).toEqual({ kind: "unknown" });
    },
  );

  it("returns unknown for nested subdomains", () => {
    expect(parse("a.b.platform.test")).toEqual({ kind: "unknown" });
  });

  it("treats any other hostname as a custom domain", () => {
    expect(parse("Shop.Example.com")).toEqual({ kind: "custom-domain", hostname: "shop.example.com" });
  });

  it("ignores case, port and a trailing dot", () => {
    expect(parseRequestTarget("ACME.localhost:3001", { platformDomain: "localhost", storeDomain: "localhost" })).toEqual(
      { kind: "store", slug: "acme" },
    );
    expect(parse("acme.platform.test.")).toEqual({ kind: "store", slug: "acme" });
  });

  it("treats labels named after built-in object properties as stores", () => {
    expect(parse("constructor.platform.test")).toEqual({ kind: "store", slug: "constructor" });
    expect(parse("__proto__.platform.test")).toEqual({ kind: "unknown" });
  });

  it("treats lookalike domains as custom domains, never as platform hosts", () => {
    expect(parse("evil-platform.test")).toEqual({ kind: "custom-domain", hostname: "evil-platform.test" });
    expect(parse("platform.test.evil.com")).toEqual({ kind: "custom-domain", hostname: "platform.test.evil.com" });
  });

  it("accepts bracketed IPv6 hosts with a port as custom domains", () => {
    expect(parse("[::1]:8787")).toEqual({ kind: "custom-domain", hostname: "[::1]" });
  });

  it.each(["", " ", "acme.platform.test..", "shop_1.example.com", "a b.example.com"])(
    "returns unknown for the invalid hostname %j",
    (hostname) => {
      expect(parse(hostname)).toEqual({ kind: "unknown" });
    },
  );

  it("returns unknown when a configured domain is invalid", () => {
    expect(parseRequestTarget("acme.platform.test", { platformDomain: "platform.test", storeDomain: "" })).toEqual({
      kind: "unknown",
    });
  });
});

describe("parseRequestTarget with a separate store domain", () => {
  it("maps a subdomain of the store domain to a store", () => {
    expect(parseSplit("acme.stores.test")).toEqual({ kind: "store", slug: "acme" });
  });

  it("keeps the platform apps on the platform domain", () => {
    expect(parseSplit("platform.test")).toEqual({ kind: "platform", app: "www" });
    expect(parseSplit("dash.platform.test")).toEqual({ kind: "platform", app: "dash" });
    expect(parseSplit("admin.platform.test")).toEqual({ kind: "platform", app: "admin" });
  });

  it.each(["acme.platform.test", "stores.test", "a.b.stores.test", "a.b.platform.test", "admin.stores.test"])(
    "returns unknown for %s",
    (hostname) => {
      expect(parseSplit(hostname)).toEqual({ kind: "unknown" });
    },
  );

  it("treats other hostnames as custom domains", () => {
    expect(parseSplit("shop.example.com")).toEqual({ kind: "custom-domain", hostname: "shop.example.com" });
  });
});
