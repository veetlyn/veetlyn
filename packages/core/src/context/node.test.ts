import { describe, expect, it } from "vitest";

import { canStore, canWorkspace, type SellerFacts, sellerOf, sellerSections, storeRoleFor } from "./node";

const pagesOf = (facts: SellerFacts) => Object.fromEntries(sellerSections(facts).map((s) => [s.section, s.pages]));

describe("sellerSections", () => {
  it("gives a services team admin every section", () => {
    expect(pagesOf({ seller: { product: "services", role: "admin" }, solo: false, storeEnabled: false })).toEqual({
      requests: ["requests"],
      projects: ["projects"],
      money: ["payments", "payouts", "cases"],
      storefront: ["services", "preview"],
      team: ["members"],
      settings: ["settings"],
    });
  });

  it("drops open requests, payouts and members for a solo seller", () => {
    expect(pagesOf({ seller: { product: "services", role: "admin" }, solo: true, storeEnabled: false })).toEqual({
      projects: ["projects"],
      money: ["payments", "cases"],
      storefront: ["services", "preview"],
      settings: ["settings"],
    });
  });

  it("adds products and orders when a services team also sells downloads", () => {
    const sections = pagesOf({ seller: { product: "services", role: "admin" }, solo: false, storeEnabled: true });
    expect(sections.storefront).toEqual(["services", "products", "orders", "preview"]);
  });

  it("keeps a freelancer to the work and their own payouts", () => {
    expect(pagesOf({ seller: { product: "services", role: "freelancer" }, solo: false, storeEnabled: true })).toEqual({
      requests: ["requests"],
      projects: ["projects"],
      money: ["payouts"],
      storefront: ["services", "products"],
      team: ["members"],
      settings: ["settings"],
    });
  });

  it("gives a store its storefront and settings, and no services sections", () => {
    expect(pagesOf({ seller: { product: "store", role: "admin" }, solo: false, storeEnabled: true })).toEqual({
      storefront: ["products", "orders", "preview"],
      settings: ["settings"],
    });
  });

  it("lets store staff see the catalog and orders but not the settings", () => {
    expect(pagesOf({ seller: { product: "store", role: "staff" }, solo: false, storeEnabled: true })).toEqual({
      storefront: ["products", "orders"],
    });
  });
});

describe("store and workspace authority", () => {
  it("makes workspace owners and admins store admins, team members staff, and anyone else nobody", () => {
    expect(storeRoleFor("owner", false)).toBe("admin");
    expect(storeRoleFor("member,admin", false)).toBe("admin");
    expect(storeRoleFor("member", true)).toBe("staff");
    expect(storeRoleFor("member", false)).toBeNull();
  });

  it("keeps catalog changes and settings to store admins", () => {
    expect(canStore("staff", "view_catalog")).toBe(true);
    expect(canStore("staff", "manage_catalog")).toBe(false);
    expect(canStore("staff", "manage_settings")).toBe(false);
    expect(canStore("admin", "manage_catalog")).toBe(true);
    expect(canStore(null, "view_store")).toBe(false);
  });

  it("lets every member see the workspace and only owners and admins run billing", () => {
    expect(canWorkspace("member", "view_workspace")).toBe(true);
    expect(canWorkspace("member", "manage_billing")).toBe(false);
    expect(canWorkspace("owner", "manage_billing")).toBe(true);
    expect(canWorkspace(null, "view_workspace")).toBe(false);
  });
});

describe("sellerOf", () => {
  it("names the seller below the workspace and none above it", () => {
    expect(sellerOf({ kind: "account" })).toBeNull();
    expect(sellerOf({ kind: "workspace", organizationId: "o1" })).toBeNull();
    expect(sellerOf({ kind: "record", teamId: "t1", record: { type: "project", id: "p1" } })).toBe("t1");
  });
});
