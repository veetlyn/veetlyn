import { describe, expect, it } from "vitest";

import { systemPrompt } from "./turn";

const team = { id: "team-1", name: "Walk Crew" };

describe("the assistant's instructions", () => {
  // Walkthrough W3.3: with the payout tools withheld, a freelancer was sent to approve payouts on the Payouts page.
  it("tells the assistant what a freelancer's role keeps out of reach, and who handles it", () => {
    const prompt = systemPrompt("Platform", { team, userId: "u-1", role: "freelancer" }, null);
    expect(prompt).toContain("cannot see or act on the team's payouts, payout rules and client payments, and PayPal cases");
    expect(prompt).toContain("a team admin handles them");
  });

  it("adds no such limits for an admin", () => {
    const prompt = systemPrompt("Platform", { team, userId: "u-1", role: "admin" }, null);
    expect(prompt).not.toContain("cannot see or act on");
  });

  // Walkthrough W3.5: a progress note called a USD quote "€150".
  it("keeps every amount in its record's currency, progress notes included", () => {
    const prompt = systemPrompt("Platform", { team, userId: "u-1", role: "freelancer" }, null);
    expect(prompt).toContain("never assume or convert a currency, not even in a short progress note");
  });
});
