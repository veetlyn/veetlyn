import { describe, expect, it } from "vitest";

import { clientNoticeEmail, disputeAlertEmail, memberNoticeEmail } from "./notices";

describe("clientNoticeEmail", () => {
  it("writes the quote notice with the team's and project's names and the client page link", () => {
    const email = clientNoticeEmail({
      platformName: "Platform",
      name: "Amadou",
      teamName: "Walk Crew",
      projectTitle: "Brand refresh",
      key: "quote_sent",
      url: "https://team.example.com/c/token",
    });
    expect(email.subject).toBe("Your quote from Walk Crew");
    expect(email.text).toContain("Hi Amadou,");
    expect(email.text).toContain('"Brand refresh"');
    expect(email.text).toContain("https://team.example.com/c/token");
    expect(email.html).toContain("https://team.example.com/c/token");
  });

  it("names the payment kind in a payment request", () => {
    const email = clientNoticeEmail({
      platformName: "Platform",
      name: "Amadou",
      teamName: "Walk Crew",
      projectTitle: "Brand refresh",
      key: "payment_requested",
      detail: "the deposit",
      url: "https://team.example.com/c/token",
    });
    expect(email.subject).toBe("Payment requested: the deposit");
    expect(email.text).toContain("requests a payment");
  });

  it("tells an abandoned project its payments stay settled", () => {
    const email = clientNoticeEmail({
      platformName: "Platform",
      name: "Amadou",
      teamName: "Walk Crew",
      projectTitle: "Brand refresh",
      key: "project_abandoned",
      url: "https://team.example.com/c/token",
    });
    expect(email.text).toContain("Payments already made stay settled");
  });
});

describe("memberNoticeEmail", () => {
  it("writes the payout update with its status detail", () => {
    const email = memberNoticeEmail({
      platformName: "Platform",
      name: "Fatou",
      teamName: "Walk Crew",
      projectTitle: "",
      key: "payout_update",
      detail: "sent (USD 25.00)",
      url: "https://dash.example.com/payouts",
    });
    expect(email.subject).toBe("Your payout sent (USD 25.00)");
    expect(email.text).toContain("https://dash.example.com/payouts");
    expect(email.text).toContain("turn team emails off");
  });

  it("names the window in a strike warning", () => {
    const email = memberNoticeEmail({
      platformName: "Platform",
      name: "Fatou",
      teamName: "Walk Crew",
      projectTitle: "Brand refresh",
      key: "strike_warning",
      detail: "3 marks in 30 days",
      url: "https://dash.example.com/team/marks",
    });
    expect(email.text).toContain("suspended from new requests");
  });
});

describe("disputeAlertEmail", () => {
  it("carries the dispute id, reason and amount", () => {
    const email = disputeAlertEmail({
      platformName: "Platform",
      teamName: "Walk Crew",
      projectTitle: "Brand refresh",
      disputeId: "PP-D-1234",
      reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
      amount: "USD 120.50",
      url: "https://dash.example.com/team/projects/p1",
    });
    expect(email.subject).toBe("PayPal dispute PP-D-1234");
    expect(email.text).toContain("MERCHANDISE_OR_SERVICE_NOT_RECEIVED");
    expect(email.text).toContain("USD 120.50");
    expect(email.text).toContain("Timers and payouts are paused");
  });
});
