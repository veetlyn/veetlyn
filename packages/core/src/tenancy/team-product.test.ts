import { describe, expect, it } from "vitest";

import { isTeamProduct, TEAM_PRODUCTS } from "./team-product";

describe("isTeamProduct", () => {
  it("accepts the two products", () => {
    expect(TEAM_PRODUCTS).toEqual(["store", "services"]);
    expect(isTeamProduct("store")).toBe(true);
    expect(isTeamProduct("services")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isTeamProduct("shop")).toBe(false);
    expect(isTeamProduct(undefined)).toBe(false);
    expect(isTeamProduct(null)).toBe(false);
  });
});
