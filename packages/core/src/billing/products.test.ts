import { describe, expect, it } from "vitest";

import { BILLING_PRODUCTS, parsePolarProductKey, polarProductKey } from "./products";

describe("Polar products", () => {
  it("has one product per plan choice and interval: 15 choices, 30 products", () => {
    expect(BILLING_PRODUCTS).toHaveLength(30);
    expect(new Set(BILLING_PRODUCTS.map((p) => p.key)).size).toBe(30);
  });

  it("maps a choice to its key and back, and rejects keys it did not make", () => {
    const choice = { servicesTier: "team", storeTier: null, interval: "yearly" } as const;
    expect(polarProductKey(choice)).toBe("team:-:yearly");
    expect(parsePolarProductKey("team:-:yearly")).toEqual(choice);
    expect(parsePolarProductKey("-:-:monthly")).toBeNull();
    expect(parsePolarProductKey("gold:-:monthly")).toBeNull();
  });

  it("charges a single plan its price, a bundle its bundle total, and a year as 12 months", () => {
    const price = (key: string) => BILLING_PRODUCTS.find((p) => p.key === key)?.chargeCents;
    expect(price("solo:-:monthly")).toBe(1900);
    expect(price("-:grow:monthly")).toBe(3900);
    expect(price("team:grow:monthly")).toBe(7850);
    expect(price("solo:-:yearly")).toBe(12 * 1600);
  });
});
