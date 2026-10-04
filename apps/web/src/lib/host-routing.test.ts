import { describe, expect, it } from "vitest";

import { shouldForwardToApi } from "./host-routing";

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
