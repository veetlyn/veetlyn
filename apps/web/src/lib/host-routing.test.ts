import { describe, expect, it } from "vitest";

import { routeForHost, shouldForwardToApi } from "./host-routing";

const DOMAIN = "payleor.app";
const forwards = (href: string) => shouldForwardToApi(new URL(href), DOMAIN);

describe("shouldForwardToApi", () => {
  it("forwards auth and tRPC requests", () => {
    expect(forwards("https://admin.payleor.app/api/auth/get-session")).toBe(true);
    expect(forwards("https://admin.payleor.app/trpc/store.listMine?batch=1")).toBe(true);
  });

  it("forwards store API paths, including path-based stores", () => {
    expect(forwards("https://acme.payleor.app/api/store")).toBe(true);
    expect(forwards("https://store.payleor.app/acme/api/store")).toBe(true);
  });

  it("leaves pages and look-alike paths to the web app", () => {
    for (const href of [
      "https://admin.payleor.app/acme",
      "https://payleor.app/apiary",
      "https://admin.payleor.app/trpcx",
      "https://store.payleor.app/acme/products",
    ]) {
      expect(forwards(href)).toBe(false);
    }
  });
});

const route = (href: string) => routeForHost(new URL(href), DOMAIN);

describe("routeForHost", () => {
  it("passes marketing hosts through", () => {
    expect(route("https://payleor.app/")).toEqual({ kind: "pass" });
    expect(route("https://www.payleor.app/pricing")).toEqual({ kind: "pass" });
  });

  it("rewrites the admin host into /admin", () => {
    expect(route("https://admin.payleor.app/")).toEqual({ kind: "rewrite", pathname: "/admin", basePath: "" });
    expect(route("https://admin.payleor.app/acme/orders")).toEqual({
      kind: "rewrite",
      pathname: "/admin/acme/orders",
      basePath: "",
    });
  });

  it("rewrites store subdomains into /store", () => {
    expect(route("https://acme.payleor.app/")).toEqual({ kind: "rewrite", pathname: "/store", basePath: "" });
    expect(route("https://acme.payleor.app/products")).toEqual({
      kind: "rewrite",
      pathname: "/store/products",
      basePath: "",
    });
  });

  it("rewrites path-based stores into /store and keeps their base path", () => {
    expect(route("https://store.payleor.app/acme")).toEqual({ kind: "rewrite", pathname: "/store", basePath: "/acme" });
    expect(route("https://store.payleor.app/acme/products")).toEqual({
      kind: "rewrite",
      pathname: "/store/products",
      basePath: "/acme",
    });
  });

  it("rewrites custom domains into /store", () => {
    expect(route("https://shop.example.com/products")).toEqual({
      kind: "rewrite",
      pathname: "/store/products",
      basePath: "",
    });
  });

  it("blocks direct requests for the internal route trees on every host", () => {
    for (const href of ["https://payleor.app/admin", "https://acme.payleor.app/store/x", "https://admin.payleor.app/admin"]) {
      expect(route(href)).toEqual({ kind: "not-found" });
    }
  });

  it("serves nothing on api, mcp and unknown hosts", () => {
    for (const href of ["https://api.payleor.app/", "https://mcp.payleor.app/", "https://docs.payleor.app/", "https://a.b.payleor.app/"]) {
      expect(route(href)).toEqual({ kind: "not-found" });
    }
  });
});
