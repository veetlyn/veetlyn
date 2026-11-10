import { FULL_ACCESS, type ServicesTeamRole } from "@jendal-workspace/core";
import { sellerSections } from "@jendal-workspace/core/context/node";
import { describe, expect, it } from "vitest";

import { type CallScope, systemPrompt } from "./turn";

function inTeam(role: ServicesTeamRole): CallScope {
  const seller = { product: "services" as const, role };
  return {
    node: { kind: "seller", teamId: "team-1" },
    userId: "u-1",
    workspace: { id: "org-1", name: "Walk Crew studio", role: "member" },
    seller: { id: "team-1", name: "Walk Crew", slug: "walk-crew", role: seller, access: FULL_ACCESS, sections: sellerSections({ seller, solo: false, storeEnabled: false }) },
    section: null,
    project: null,
  };
}

describe("the assistant's instructions", () => {
  // Walkthrough W3.3: with the payout tools withheld, a freelancer was sent to approve payouts on the Payouts page.
  it("tells the assistant what a freelancer's role keeps out of reach, and who handles it", () => {
    const prompt = systemPrompt("Platform", inTeam("freelancer"), 5);
    expect(prompt).toContain("cannot see or act on the team's payouts, payout rules and client payments, and PayPal cases");
    expect(prompt).toContain("a team admin handles them");
  });

  it("adds no such limits for an admin", () => {
    const prompt = systemPrompt("Platform", inTeam("admin"), 11);
    expect(prompt).not.toContain("cannot see or act on");
  });

  // Walkthrough W3.5: a progress note called a USD quote "€150".
  it("keeps every amount in its record's currency, progress notes included", () => {
    const prompt = systemPrompt("Platform", inTeam("freelancer"), 5);
    expect(prompt).toContain("never assume or convert a currency, not even in a short progress note");
  });

  // Walk 2026-11-10: a catch-up answer came back as one long wall of text.
  it("asks for a short lead sentence and a capped list, so answers stay readable", () => {
    const prompt = systemPrompt("Platform", inTeam("admin"), 11);
    expect(prompt).toContain("Start with one sentence that answers the question");
    expect(prompt).toContain("at most 6 short bullets");
  });

  it("tells the assistant to look people and records up instead of asking the person for an id", () => {
    const prompt = systemPrompt("Platform", inTeam("admin"), 11);
    expect(prompt).toContain("Never ask the person for an id");
  });
});
