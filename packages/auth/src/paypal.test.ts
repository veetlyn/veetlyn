import { describe, expect, it } from "vitest";

import { paypalEmail } from "./paypal";

describe("paypalEmail", () => {
  it("reads the primary address from the paypalv1.1 emails list", () => {
    const profile = {
      emails: [
        { value: "old@example.com", primary: false, confirmed: true },
        { value: "ada@example.com", primary: true, confirmed: true },
      ],
    };

    expect(paypalEmail(profile)).toEqual({ email: "ada@example.com", emailVerified: true });
  });

  it("treats an unconfirmed address as unverified", () => {
    expect(paypalEmail({ emails: [{ value: "ada@example.com", primary: true }] })).toEqual({
      email: "ada@example.com",
      emailVerified: false,
    });
  });

  it("falls back to the first address when none is marked primary", () => {
    expect(paypalEmail({ emails: [{ value: "ada@example.com" }] })).toMatchObject({ email: "ada@example.com" });
  });

  it("keeps a top-level OpenID email when PayPal sends one", () => {
    expect(paypalEmail({ email: "ada@example.com", email_verified: true })).toEqual({
      email: "ada@example.com",
      emailVerified: true,
    });
  });

  it("returns nothing when the profile has no address", () => {
    expect(paypalEmail({})).toEqual({});
  });
});
