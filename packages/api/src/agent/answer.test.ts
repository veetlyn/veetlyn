import { describe, expect, it } from "vitest";

import { sanitizeAgentAnswer } from "./answer";

describe("sanitizeAgentAnswer", () => {
  it("removes internal ids, field names and raw timestamps from an answer", () => {
    const dirty =
      "Project f5349023-c16c-48bb-a849-c84ed6dc63d9 is quoting. ratings.canRateClient is true and clientRating is 5. Updated 2026-11-02T10:30:00.000Z.";
    const clean = sanitizeAgentAnswer(dirty);
    expect(clean).not.toContain("f5349023");
    expect(clean).not.toContain("canRateClient");
    expect(clean).not.toContain("clientRating");
    expect(clean).not.toContain("2026-11-02T10:30:00.000Z");
    expect(clean).toContain("quoting");
  });

  it("removes truncated ids and field values left as bare booleans", () => {
    const clean = sanitizeAgentAnswer("Project 0cf0ce75... can be rated: `canRate: true` and it is done.");
    expect(clean).not.toContain("0cf0ce75");
    expect(clean).not.toContain("true");
    expect(clean).toContain("can be rated");
  });

  it("removes a parenthesised short id", () => {
    expect(sanitizeAgentAnswer("Payout for Logo refresh (00fbf3ae) is waiting.")).toBe("Payout for Logo refresh is waiting.");
  });

  it("keeps web addresses the person needs", () => {
    expect(sanitizeAgentAnswer("Your seller page is at walk-crew.example.app and the dashboard at example.com.")).toBe(
      "Your seller page is at walk-crew.example.app and the dashboard at example.com.",
    );
  });

  it("leaves no empty separators where an id was removed", () => {
    expect(sanitizeAgentAnswer("Logo refresh (Pain Doré) — f5349023-c16c-48bb-a849-c84ed6dc63d9 — in the request space.")).toBe(
      "Logo refresh (Pain Doré) — in the request space.",
    );
  });

  it("leaves a plain answer untouched", () => {
    const plain = "The quote is $300.00 and the client is waiting for the deposit.";
    expect(sanitizeAgentAnswer(plain)).toBe(plain);
  });
});
