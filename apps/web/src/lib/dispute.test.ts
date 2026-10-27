import { describe, expect, it } from "vitest";

import { disputeCaseUrl, disputeEffect } from "./dispute";

describe("disputeCaseUrl", () => {
  it("opens the case on the PayPal host of the deployment's environment", () => {
    expect(disputeCaseUrl("sandbox", "PP-R-TYE-10194759")).toBe("https://www.sandbox.paypal.com/resolutioncenter/view/PP-R-TYE-10194759");
    expect(disputeCaseUrl("live", "PP-R-TYE-10194759")).toBe("https://www.paypal.com/resolutioncenter/view/PP-R-TYE-10194759");
  });
});

describe("disputeEffect", () => {
  it("says the hold lasts while the case is open and lifts only when the team wins", () => {
    expect(disputeEffect("under_review")).toMatch(/paused/);
    expect(disputeEffect("resolved_seller")).toMatch(/resumed/);
    expect(disputeEffect("resolved_buyer")).toMatch(/stopped/);
  });
});
