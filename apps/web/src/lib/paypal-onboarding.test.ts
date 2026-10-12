import { describe, expect, it } from "vitest";

import { payPalOnboardingLinks } from "./paypal-onboarding";

describe("payPalOnboardingLinks", () => {
  it("builds the mini-browser href and the sandbox partner.js URL from a sandbox action URL", () => {
    expect(payPalOnboardingLinks("https://www.sandbox.paypal.com/bizsignup/entry?partnerId=P1&token=T1")).toEqual({
      miniBrowserHref: "https://www.sandbox.paypal.com/bizsignup/entry?partnerId=P1&token=T1&displayMode=minibrowser",
      partnerScriptSrc: "https://www.sandbox.paypal.com/webapps/merchantboarding/js/lib/lightbox/partner.js",
    });
  });

  it("uses the live partner.js for a live action URL", () => {
    const links = payPalOnboardingLinks("https://www.paypal.com/bizsignup/entry?partnerId=P1&token=T1");
    expect(links?.partnerScriptSrc).toBe("https://www.paypal.com/webapps/merchantboarding/js/lib/lightbox/partner.js");
    expect(links?.miniBrowserHref).toContain("displayMode=minibrowser");
  });

  it("replaces a displayMode the action URL already carries", () => {
    const links = payPalOnboardingLinks("https://www.paypal.com/bizsignup/entry?partnerId=P1&displayMode=regular");
    expect(links?.miniBrowserHref).toContain("displayMode=minibrowser");
    expect(links?.miniBrowserHref).not.toContain("displayMode=regular");
  });

  it("returns null for a non-PayPal or unreadable URL", () => {
    expect(payPalOnboardingLinks("https://example.com/bizsignup/entry")).toBeNull();
    expect(payPalOnboardingLinks("www.paypal.com")).toBeNull();
    expect(payPalOnboardingLinks("not a url")).toBeNull();
  });
});
