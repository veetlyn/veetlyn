import { describe, expect, it } from "vitest";

import { buildAuthAssertion } from "./index";

describe("buildAuthAssertion", () => {
  // PayPal's documented unsigned JWT: alg "none", iss + payer_id claims, empty signature (Fact 7).
  it("builds the unsigned JWT PayPal documents", () => {
    const parts = buildAuthAssertion({ clientId: "partner-client-id", payerId: "SELLER42" }).split(".");

    expect(parts).toHaveLength(3);
    expect(JSON.parse(atob(String(parts[0])))).toEqual({ alg: "none" });
    expect(JSON.parse(atob(String(parts[1])))).toEqual({ iss: "partner-client-id", payer_id: "SELLER42" });
    expect(parts[2]).toBe("");
  });
});
