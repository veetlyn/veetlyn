import { describe, expect, it } from "vitest";

import { parseRequestTarget, routingPath } from "./target";

const DOMAIN = "jendal.app";
const parse = (hostname: string, pathname = "/") => parseRequestTarget({ hostname, pathname }, DOMAIN);

describe("parseRequestTarget", () => {
  it("maps the apex domain to the www platform app", () => {
    expect(parse("jendal.app")).toEqual({ kind: "platform", app: "www" });
  });

  it.each([
    ["www.jendal.app", "www"],
    ["admin.jendal.app", "admin"],
    ["api.jendal.app", "api"],
    ["mcp.jendal.app", "mcp"],
  ] as const)("maps %s to the %s platform app", (hostname, app) => {
    expect(parse(hostname)).toEqual({ kind: "platform", app });
  });

  it("maps a store subdomain to a store with no base path", () => {
    expect(parse("acme.jendal.app", "/products")).toEqual({ kind: "store", slug: "acme", basePath: "" });
  });

  it("maps store.jendal.app/{slug}/ to a store with a base path", () => {
    expect(parse("store.jendal.app", "/acme/products/1")).toEqual({
      kind: "store",
      slug: "acme",
      basePath: "/acme",
    });
  });

  it("returns unknown for store.jendal.app without a slug", () => {
    expect(parse("store.jendal.app", "/")).toEqual({ kind: "unknown" });
  });

  it("returns unknown for store.jendal.app with a reserved first segment", () => {
    expect(parse("store.jendal.app", "/admin/x")).toEqual({ kind: "unknown" });
  });

  it("returns unknown for reserved subdomains that are not platform apps", () => {
    expect(parse("docs.jendal.app")).toEqual({ kind: "unknown" });
  });

  it("returns unknown for nested subdomains", () => {
    expect(parse("a.b.jendal.app")).toEqual({ kind: "unknown" });
  });

  it("treats any other hostname as a custom domain", () => {
    expect(parse("Shop.Example.com")).toEqual({ kind: "custom-domain", hostname: "shop.example.com" });
  });

  it("ignores case, port and a trailing dot", () => {
    expect(parseRequestTarget({ hostname: "ACME.localhost:3001", pathname: "/" }, "localhost")).toEqual({
      kind: "store",
      slug: "acme",
      basePath: "",
    });
    expect(parse("acme.jendal.app.")).toEqual({ kind: "store", slug: "acme", basePath: "" });
  });

  it("treats labels named after built-in object properties as stores", () => {
    expect(parse("constructor.jendal.app")).toEqual({ kind: "store", slug: "constructor", basePath: "" });
    expect(parse("__proto__.jendal.app")).toEqual({ kind: "unknown" });
  });

  it("treats lookalike domains as custom domains, never as platform hosts", () => {
    expect(parse("evil-jendal.app")).toEqual({ kind: "custom-domain", hostname: "evil-jendal.app" });
    expect(parse("jendal.app.evil.com")).toEqual({ kind: "custom-domain", hostname: "jendal.app.evil.com" });
  });

  it("accepts bracketed IPv6 hosts with a port as custom domains", () => {
    expect(parse("[::1]:8787")).toEqual({ kind: "custom-domain", hostname: "[::1]" });
  });

  it.each(["", " ", "acme.jendal.app..", "shop_1.example.com", "a b.example.com"])(
    "returns unknown for the invalid hostname %j",
    (hostname) => {
      expect(parse(hostname)).toEqual({ kind: "unknown" });
    },
  );

  it("only accepts a path-based store whose segment is already a clean slug", () => {
    expect(parse("store.jendal.app", "/acme/")).toEqual({ kind: "store", slug: "acme", basePath: "/acme" });
    for (const pathname of ["/ACME/x", "/ acme/x", "//acme", "/ac%6De"]) {
      expect(parse("store.jendal.app", pathname)).toEqual({ kind: "unknown" });
    }
  });
});

describe("routingPath", () => {
  it("strips the base path of path-based stores", () => {
    expect(routingPath(parse("store.jendal.app", "/acme/api/store"), "/acme/api/store")).toBe("/api/store");
  });

  it("returns / for the root of a path-based store", () => {
    expect(routingPath(parse("store.jendal.app", "/acme"), "/acme")).toBe("/");
  });

  it("leaves a pathname that does not start with the base path segment unchanged", () => {
    const target = parse("store.jendal.app", "/acme/x");
    expect(routingPath(target, "/other/x")).toBe("/other/x");
    expect(routingPath(target, "/acmex/y")).toBe("/acmex/y");
  });

  it("leaves every other target unchanged", () => {
    expect(routingPath(parse("acme.jendal.app", "/api/store"), "/api/store")).toBe("/api/store");
    expect(routingPath(parse("admin.jendal.app", "/acme"), "/acme")).toBe("/acme");
  });
});
