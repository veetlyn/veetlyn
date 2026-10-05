import { describe, expect, it } from "vitest";

import { passwordResetEmail, verificationEmail } from "./templates";

const url = "https://admin.payleor.app/api/auth/verify-email?token=abc&callbackURL=%2Fnew";

describe("verificationEmail", () => {
  it("links to the verification URL in both parts", () => {
    const email = verificationEmail({ name: "Ada", url });

    expect(email.subject).toBe("Verify your email for Payleor");
    expect(email.text).toContain(url);
    expect(email.text).toContain("expires in 1 hour");
    expect(email.html).toContain('href="https://admin.payleor.app/api/auth/verify-email?token=abc&amp;callbackURL=%2Fnew"');
  });

  it("escapes the name in the HTML part", () => {
    const email = verificationEmail({ name: "<script>alert(1)</script>", url });

    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });
});

describe("passwordResetEmail", () => {
  it("links to the reset URL and says what happens if it was not requested", () => {
    const resetUrl = "https://admin.payleor.app/api/auth/reset-password/tok?callbackURL=%2Freset-password";
    const email = passwordResetEmail({ name: "Ada", url: resetUrl });

    expect(email.subject).toBe("Reset your Payleor password");
    expect(email.text).toContain(resetUrl);
    expect(email.text).toContain("your password stays the same");
    expect(email.html).toContain(`href="${resetUrl}"`);
  });
});
