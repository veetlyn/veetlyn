import { describe, expect, it } from "vitest";

import { pricingOffers, saleFees } from "./fees";

describe("saleFees", () => {
  it("charges a services plan's fee, plus 5% once when the network brought the client", () => {
    expect(saleFees({ kind: "services", planId: "team", amountMinor: 4_500, source: "network" })).toEqual({
      feeBps: 50,
      feeMinor: 23,
      networkMinor: 225,
      totalMinor: 248,
    });
  });

  it("never charges the network fee on the seller's own clients or on store orders", () => {
    expect(saleFees({ kind: "services", planId: "team", amountMinor: 64_000, source: "own" }).networkMinor).toBe(0);
    expect(saleFees({ kind: "store", planId: "grow", amountMinor: 1_800, source: "network" })).toEqual({
      feeBps: 100,
      feeMinor: 18,
      networkMinor: 0,
      totalMinor: 18,
    });
  });

  it("charges nothing on an empty amount instead of throwing", () => {
    expect(saleFees({ kind: "store", planId: "starter", amountMinor: 0, source: "own" }).totalMinor).toBe(0);
  });
});

describe("pricingOffers", () => {
  it("lists every services and store plan with its monthly price and fee", () => {
    const offers = pricingOffers();
    expect(offers.map((o) => o.name)).toEqual(["Solo", "Team", "Agency", "Starter", "Grow", "Scale"]);
    expect(offers[0]).toEqual({
      "@type": "Offer",
      name: "Solo",
      price: "19.00",
      priceCurrency: "USD",
      description: "A month, 1% on each client payment",
    });
    expect(offers[3]?.description).toBe("A month, 2% on each order");
  });
});
