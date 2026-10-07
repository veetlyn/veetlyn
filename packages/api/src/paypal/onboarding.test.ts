import { PARTNER_REFERRAL_FEATURES } from "@jendal-workspace/paypal";
import { describe, expect, it } from "vitest";

import { partnerReferralFeaturesFor } from "./onboarding";

describe("partnerReferralFeaturesFor", () => {
  it("asks a store for every platform feature", () => {
    expect(partnerReferralFeaturesFor("store")).toEqual([...PARTNER_REFERRAL_FEATURES]);
  });

  it("leaves shipment tracking out for a services team", () => {
    expect(partnerReferralFeaturesFor("services")).toEqual([
      "PAYMENT",
      "REFUND",
      "PARTNER_FEE",
      "READ_SELLER_DISPUTE",
      "UPDATE_SELLER_DISPUTE",
      "ACCESS_MERCHANT_INFORMATION",
    ]);
  });
});
