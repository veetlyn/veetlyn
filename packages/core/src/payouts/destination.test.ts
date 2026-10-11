import { describe, expect, it } from "vitest";

import { payoutDestinationFromUserInfo } from "./destination";

// Shapes from PayPal's userinfo endpoint (schema=paypalv1.1, Fact 14). The account ID Better Auth
// stores for a PayPal account is this user_id, which is not the payer ID.
const USER_ID = "https://www.paypal.com/webapps/auth/identity/user/abc123";

describe("payoutDestinationFromUserInfo", () => {
  it("takes the payer ID and the verified email from the linked account's userinfo", () => {
    expect(
      payoutDestinationFromUserInfo(USER_ID, {
        user_id: USER_ID,
        payer_id: "G83JXTJ5EHCQ2",
        email: "ada@example.com",
        email_verified: true,
      }),
    ).toEqual({ paypalPayerId: "G83JXTJ5EHCQ2", paypalEmail: "ada@example.com" });
  });

  it("reads the email from the emails list, keeping only a confirmed address", () => {
    const emails = [
      { value: "old@example.com", primary: false, confirmed: true },
      { value: "ada@example.com", primary: true, confirmed: true },
    ];
    expect(payoutDestinationFromUserInfo(USER_ID, { user_id: USER_ID, payer_id: "G83JXTJ5EHCQ2", emails })).toEqual({
      paypalPayerId: "G83JXTJ5EHCQ2",
      paypalEmail: "ada@example.com",
    });
    expect(
      payoutDestinationFromUserInfo(USER_ID, {
        user_id: USER_ID,
        payer_id: "G83JXTJ5EHCQ2",
        emails: [{ value: "ada@example.com", primary: true, confirmed: false }],
      }),
    ).toEqual({ paypalPayerId: "G83JXTJ5EHCQ2", paypalEmail: null });
  });

  it("drops an email PayPal did not verify, or did not say it verified", () => {
    const base = { user_id: USER_ID, payer_id: "G83JXTJ5EHCQ2", email: "ada@example.com" };
    expect(payoutDestinationFromUserInfo(USER_ID, { ...base, email_verified: false })?.paypalEmail).toBeNull();
    expect(payoutDestinationFromUserInfo(USER_ID, base)?.paypalEmail).toBeNull();
  });

  it("refuses userinfo for another PayPal account, a missing or malformed payer ID, and non-objects", () => {
    expect(payoutDestinationFromUserInfo(USER_ID, { user_id: "someone-else", payer_id: "G83JXTJ5EHCQ2" })).toBeNull();
    expect(payoutDestinationFromUserInfo(USER_ID, { user_id: USER_ID })).toBeNull();
    expect(payoutDestinationFromUserInfo(USER_ID, { user_id: USER_ID, payer_id: USER_ID })).toBeNull();
    expect(payoutDestinationFromUserInfo(USER_ID, { user_id: USER_ID, payer_id: "g83jxtj5ehcq2" })).toBeNull();
    expect(payoutDestinationFromUserInfo(USER_ID, null)).toBeNull();
  });
});
