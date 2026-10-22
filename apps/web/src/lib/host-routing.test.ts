import type { HostDomains } from "@jendal-workspace/core";
import { describe, expect, it } from "vitest";

import { routeForHost, shouldForwardToApi } from "./host-routing";

const SAME: HostDomains = { platformDomain: "platform.test", storeDomain: "platform.test" };
const SPLIT: HostDomains = { platformDomain: "platform.test", storeDomain: "platform.site" };
const forwards = (href: string) => shouldForwardToApi(new URL(href));

describe("shouldForwardToApi", () => {
  it("forwards auth and tRPC requests", () => {
    expect(forwards("https://admin.platform.test/api/auth/get-session")).toBe(true);
    expect(forwards("https://admin.platform.test/trpc/store.listMine?batch=1")).toBe(true);
  });

  // Claude and ChatGPT read the issuer's metadata with the issuer path inserted (RFC 8414); a page answering
  // instead breaks connecting the plugin.
  it("forwards OAuth discovery for the issuer on the dashboard host", () => {
    expect(forwards("https://dash.platform.test/.well-known/oauth-authorization-server/api/auth")).toBe(true);
    expect(forwards("https://dash.platform.test/.well-known/openid-configuration/api/auth")).toBe(true);
  });

  it("forwards store API paths", () => {
    expect(forwards("https://acme.platform.test/api/store")).toBe(true);
    expect(forwards("https://shop.example.com/api/store")).toBe(true);
  });

  it("leaves pages and look-alike paths to the web app", () => {
    for (const href of [
      "https://admin.platform.test/acme",
      "https://platform.test/apiary",
      "https://admin.platform.test/trpcx",
      "https://acme.platform.test/products",
    ]) {
      expect(forwards(href)).toBe(false);
    }
  });
});

const route = (href: string, domains: HostDomains = SAME) => routeForHost(new URL(href), domains);

describe("routeForHost", () => {
  it("passes marketing hosts through", () => {
    expect(route("https://platform.test/")).toEqual({ kind: "pass" });
    expect(route("https://www.platform.test/pricing")).toEqual({ kind: "pass" });
  });

  it("rewrites the dash host into the dashboard tree", () => {
    expect(route("https://dash.platform.test/")).toEqual({ kind: "rewrite", pathname: "/dash" });
    expect(route("https://dash.platform.test/acme/orders")).toEqual({ kind: "rewrite", pathname: "/dash/acme/orders" });
  });

  // Links in emails sent before the rename point at admin.
  it("redirects the old admin host to the dash host, keeping the path and query", () => {
    expect(route("https://admin.platform.test/acme/orders?tab=open")).toEqual({
      kind: "redirect",
      location: "https://dash.platform.test/acme/orders?tab=open",
    });
    expect(route("http://admin.localhost:3001/login", { platformDomain: "localhost", storeDomain: "localhost" })).toEqual({
      kind: "redirect",
      location: "http://dash.localhost:3001/login",
    });
  });

  it("rewrites store subdomains into /store", () => {
    expect(route("https://acme.platform.test/")).toEqual({ kind: "rewrite", pathname: "/store" });
    expect(route("https://acme.platform.test/products")).toEqual({ kind: "rewrite", pathname: "/store/products" });
  });

  it("rewrites stores on a separate store domain, and nothing else under it", () => {
    expect(route("https://acme.platform.site/products", SPLIT)).toEqual({ kind: "rewrite", pathname: "/store/products" });
    expect(route("https://acme.platform.test/", SPLIT)).toEqual({ kind: "not-found" });
    expect(route("https://platform.site/", SPLIT)).toEqual({ kind: "not-found" });
  });

  it("serves nothing for the dropped path-based store URLs", () => {
    expect(route("https://store.platform.test/acme")).toEqual({ kind: "not-found" });
    expect(route("https://store.platform.test/acme/products")).toEqual({ kind: "not-found" });
  });

  it("rewrites custom domains into /store", () => {
    expect(route("https://shop.example.com/products")).toEqual({ kind: "rewrite", pathname: "/store/products" });
  });

  it("blocks direct requests for the internal route trees on every host", () => {
    for (const href of ["https://platform.test/admin", "https://acme.platform.test/store/x", "https://dash.platform.test/admin", "https://dash.platform.test/dash"]) {
      expect(route(href)).toEqual({ kind: "not-found" });
    }
  });

  it("serves nothing on api, mcp and unknown hosts", () => {
    for (const href of ["https://api.platform.test/", "https://mcp.platform.test/", "https://docs.platform.test/", "https://a.b.platform.test/"]) {
      expect(route(href)).toEqual({ kind: "not-found" });
    }
  });
});
