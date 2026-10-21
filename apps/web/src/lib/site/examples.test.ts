import { describe, expect, it } from "vitest";

import {
  agencyExample,
  freelancerExample,
  studioExample,
  walkCrewBalanceMinor,
  walkCrewDepositMinor,
} from "./examples";

// The stories quote these figures in their copy; a fee change in core fails here and names the page to update.
describe("the site's money stories", () => {
  it("Amadou keeps $578.77 of a $640 network project on Solo", () => {
    expect(freelancerExample()).toEqual({ quoteMinor: 64_000, keptMinor: 57_877, paypalMinor: 2_283, platformMinor: 3_840 });
  });

  it("Walk Crew's $640 quote splits into the freelancer, the team, PayPal and Payleor", () => {
    expect(agencyExample()).toMatchObject({
      memberMinor: 54_375,
      teamMinor: 13_142,
      paypalMinor: 2_531,
      platformMinor: 352,
    });
    expect(walkCrewDepositMinor()).toBe(38_400);
    expect(walkCrewBalanceMinor()).toBe(32_000);
  });

  it("a $45 pedicure booked through the network pays Inès, the salon, PayPal and Payleor", () => {
    expect(studioExample()).toEqual({
      priceMinor: 4_500,
      staffMinor: 2_675,
      salonMinor: 1_345,
      paypalMinor: 232,
      platformMinor: 248,
    });
  });
});
