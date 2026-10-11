import { describe, expect, it } from "vitest";

import { isStorePolicy, policiesFor, storePolicyUrls } from "./store-policies";

describe("store policies", () => {
  it("gives a store all four policies and a services team only terms and privacy", () => {
    expect(policiesFor("store")).toEqual(["returns", "shipping", "terms", "privacy"]);
    expect(policiesFor("services")).toEqual(["terms", "privacy"]);
  });

  it("recognises policy names only", () => {
    expect(isStorePolicy("returns")).toBe(true);
    expect(isStorePolicy("refunds")).toBe(false);
  });

  it("builds the policy URLs from the store's base URL, with or without a trailing slash", () => {
    const expected = {
      returns: "https://acme.payleor.site/policies/returns",
      shipping: "https://acme.payleor.site/policies/shipping",
      terms: "https://acme.payleor.site/policies/terms",
      privacy: "https://acme.payleor.site/policies/privacy",
    };
    expect(storePolicyUrls("https://acme.payleor.site")).toEqual(expected);
    expect(storePolicyUrls("https://acme.payleor.site/")).toEqual(expected);
  });
});
