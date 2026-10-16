import type { HostDomains } from "@jendal-workspace/core";
import { describe, expect, it } from "vitest";

import { routeForHost, shouldForwardToApi } from "./host-routing";

const SAME: HostDomains = { platformDomain: "payleor.app", storeDomain: "payleor.app" };
const SPLIT: HostDomains = { platformDomain: "payleor.app", storeDomain: "payleor.site" };
const forwards = (href: string) => shouldForwardToApi(new URL(href));

describe("shouldForwardToApi", () => {
  it("forwards auth and tRPC requests", () => {
    expect(forwards("https://admin.payleor.app/api/auth/get-session")).toBe(true);
    expect(forwards("https://admin.payleor.app/trpc/store.listMine?batch=1")).toBe(true);
  });

  it("forwards store API paths", () => {
    expect(forwards("https://acme.payleor.app/api/store")).toBe(true);
    expect(forwards("https://shop.example.com/api/store")).toBe(true);
  });

  it("leaves pages and look-alike paths to the web app", () => {
    for (const href of [
      "https://admin.payleor.app/acme",
      "https://payleor.app/apiary",
      "https://admin.payleor.app/trpcx",
      "https://acme.payleor.app/products",
    ]) {
      expect(forwards(href)).toBe(false);
    }
  });
});

const route = (href: string, domains: HostDomains = SAME) => routeForHost(new URL(href), domains);

describe("routeForHost", () => {
  it("passes marketing hosts through", () => {
    expect(route("https://payleor.app/")).toEqual({ kind: "pass" });
    expect(route("https://www.payleor.app/pricing")).toEqual({ kind: "pass" });
  });

  it("rewrites the dash host into the dashboard tree", () => {
    expect(route("https://dash.payleor.app/")).toEqual({ kind: "rewrite", pathname: "/admin" });
    expect(route("https://dash.payleor.app/acme/orders")).toEqual({ kind: "rewrite", pathname: "/admin/acme/orders" });
  });

  // Links in emails sent before the rename point at admin.
  it("redirects the old admin host to the dash host, keeping the path and query", () => {
    expect(route("https://admin.payleor.app/acme/orders?tab=open")).toEqual({
      kind: "redirect",
      location: "https://dash.payleor.app/acme/orders?tab=open",
    });
    expect(route("http://admin.localhost:3001/login", { platformDomain: "localhost", storeDomain: "localhost" })).toEqual({
      kind: "redirect",
      location: "http://dash.localhost:3001/login",
    });
  });

  it("rewrites store subdomains into /store", () => {
    expect(route("https://acme.payleor.app/")).toEqual({ kind: "rewrite", pathname: "/store" });
    expect(route("https://acme.payleor.app/products")).toEqual({ kind: "rewrite", pathname: "/store/products" });
  });

  it("rewrites stores on a separate store domain, and nothing else under it", () => {
    expect(route("https://acme.payleor.site/products", SPLIT)).toEqual({ kind: "rewrite", pathname: "/store/products" });
    expect(route("https://acme.payleor.app/", SPLIT)).toEqual({ kind: "not-found" });
    expect(route("https://payleor.site/", SPLIT)).toEqual({ kind: "not-found" });
  });

  it("serves nothing for the dropped path-based store URLs", () => {
    expect(route("https://store.payleor.app/acme")).toEqual({ kind: "not-found" });
    expect(route("https://store.payleor.app/acme/products")).toEqual({ kind: "not-found" });
  });

  it("rewrites custom domains into /store", () => {
    expect(route("https://shop.example.com/products")).toEqual({ kind: "rewrite", pathname: "/store/products" });
  });

  it("blocks direct requests for the internal route trees on every host", () => {
    for (const href of ["https://payleor.app/admin", "https://acme.payleor.app/store/x", "https://dash.payleor.app/admin"]) {
      expect(route(href)).toEqual({ kind: "not-found" });
    }
  });

  it("serves nothing on api, mcp and unknown hosts", () => {
    for (const href of ["https://api.payleor.app/", "https://mcp.payleor.app/", "https://docs.payleor.app/", "https://a.b.payleor.app/"]) {
      expect(route(href)).toEqual({ kind: "not-found" });
    }
  });
});
