import { describe, expect, it } from "vitest";

import { passwordResetEmail, quoteRequestLinkEmail, quoteRequestNoticeEmail, verificationEmail } from "./templates";

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

describe("quoteRequestLinkEmail", () => {
  it("points the client to their private page", () => {
    const email = quoteRequestLinkEmail({ clientName: "Jo", teamName: "Walk Crew", url: "https://payleor.com/c/t" });

    expect(email.subject).toBe("Your request to Walk Crew");
    expect(email.text).toContain("https://payleor.com/c/t");
    expect(email.html).toContain("https://payleor.com/c/t");
    expect(email.html).toContain("Hi Jo,");
  });
});

describe("quoteRequestNoticeEmail", () => {
  it("lists the request details and escapes the client name in HTML", () => {
    const email = quoteRequestNoticeEmail({
      teamName: "Walk Crew",
      clientName: "Jo <b>",
      clientEmail: "jo@x.com",
      serviceName: "Logo refresh",
      description: "A new logo",
      answers: [{ question: "Colors?", answer: "Blue" }],
      url: "https://admin.payleor.com/walk-crew/projects/p1",
    });

    expect(email.subject).toBe("New request from Jo <b>");
    expect(email.html).toContain("Jo &lt;b&gt;");
    expect(email.html).not.toContain("<b>");
    expect(email.text).toContain("Logo refresh");
    expect(email.text).toContain("A new logo");
    expect(email.text).toContain("Colors?");
    expect(email.text).toContain("Blue");
  });
});
