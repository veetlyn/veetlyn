import { describe, expect, it } from "vitest";

import { routeForHost, shouldForwardToApi } from "./host-routing";

const DOMAIN = "jendal.app";
const forwards = (href: string) => shouldForwardToApi(new URL(href), DOMAIN);

describe("shouldForwardToApi", () => {
  it("forwards auth and tRPC requests", () => {
    expect(forwards("https://admin.jendal.app/api/auth/get-session")).toBe(true);
    expect(forwards("https://admin.jendal.app/trpc/store.listMine?batch=1")).toBe(true);
  });

  it("forwards store API paths, including path-based stores", () => {
    expect(forwards("https://acme.jendal.app/api/store")).toBe(true);
    expect(forwards("https://store.jendal.app/acme/api/store")).toBe(true);
  });

  it("leaves pages and look-alike paths to the web app", () => {
    for (const href of [
      "https://admin.jendal.app/acme",
      "https://jendal.app/apiary",
      "https://admin.jendal.app/trpcx",
      "https://store.jendal.app/acme/products",
    ]) {
      expect(forwards(href)).toBe(false);
    }
  });
});

const route = (href: string) => routeForHost(new URL(href), DOMAIN);

describe("routeForHost", () => {
  it("passes marketing hosts through", () => {
    expect(route("https://jendal.app/")).toEqual({ kind: "pass" });
    expect(route("https://www.jendal.app/pricing")).toEqual({ kind: "pass" });
  });

  it("rewrites the admin host into /admin", () => {
    expect(route("https://admin.jendal.app/")).toEqual({ kind: "rewrite", pathname: "/admin", basePath: "" });
    expect(route("https://admin.jendal.app/acme/orders")).toEqual({
      kind: "rewrite",
      pathname: "/admin/acme/orders",
      basePath: "",
    });
  });

  it("rewrites store subdomains into /store", () => {
    expect(route("https://acme.jendal.app/")).toEqual({ kind: "rewrite", pathname: "/store", basePath: "" });
    expect(route("https://acme.jendal.app/products")).toEqual({
      kind: "rewrite",
      pathname: "/store/products",
      basePath: "",
    });
  });

  it("rewrites path-based stores into /store and keeps their base path", () => {
    expect(route("https://store.jendal.app/acme")).toEqual({ kind: "rewrite", pathname: "/store", basePath: "/acme" });
    expect(route("https://store.jendal.app/acme/products")).toEqual({
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
    for (const href of ["https://jendal.app/admin", "https://acme.jendal.app/store/x", "https://admin.jendal.app/admin"]) {
      expect(route(href)).toEqual({ kind: "not-found" });
    }
  });

  it("serves nothing on api, mcp and unknown hosts", () => {
    for (const href of ["https://api.jendal.app/", "https://mcp.jendal.app/", "https://docs.jendal.app/", "https://a.b.jendal.app/"]) {
      expect(route(href)).toEqual({ kind: "not-found" });
    }
  });
});
