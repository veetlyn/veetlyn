import { describe, expect, it } from "vitest";
import { clientWaitsOnTeam, isNotFoundError, teamWaitsOnClient, type ProjectWaitView } from "./project-refresh";

function view(status: string, quotes: string[] = [], amendments: string[] = []): ProjectWaitView {
  return {
    project: { status },
    quotes: quotes.map((s) => ({ status: s })),
    amendments: amendments.map((s) => ({ status: s })),
  };
}

describe("teamWaitsOnClient", () => {
  it("waits while the client owes a payment or a delivery decision", () => {
    expect(teamWaitsOnClient(view("awaiting_deposit", ["accepted"]))).toBe(true);
    expect(teamWaitsOnClient(view("delivered", ["accepted"]))).toBe(true);
    expect(teamWaitsOnClient(view("awaiting_balance", ["accepted"]))).toBe(true);
  });

  it("waits while a quote is proposed", () => {
    expect(teamWaitsOnClient(view("quoting", ["proposed"]))).toBe(true);
    expect(teamWaitsOnClient(view("quoting", ["superseded", "proposed"]))).toBe(true);
  });

  it("waits while an amendment is pending", () => {
    expect(teamWaitsOnClient(view("in_progress", ["accepted"], ["declined", "pending"]))).toBe(true);
  });

  it("does not wait when the next step is the team's or the project is over", () => {
    expect(teamWaitsOnClient(view("quoting"))).toBe(false);
    expect(teamWaitsOnClient(view("quoting", ["superseded"]))).toBe(false);
    expect(teamWaitsOnClient(view("in_progress", ["accepted"], ["accepted", "declined"]))).toBe(false);
    expect(teamWaitsOnClient(view("completed", ["accepted"]))).toBe(false);
    expect(teamWaitsOnClient(view("cancelled"))).toBe(false);
  });
});

describe("clientWaitsOnTeam", () => {
  it("waits while quoting, even with a quote proposed, for more quotes and questions", () => {
    expect(clientWaitsOnTeam(view("quoting"))).toBe(true);
    expect(clientWaitsOnTeam(view("quoting", ["proposed"]))).toBe(true);
  });

  it("waits for the work while in progress with no pending amendment", () => {
    expect(clientWaitsOnTeam(view("in_progress", ["accepted"]))).toBe(true);
    expect(clientWaitsOnTeam(view("in_progress", ["accepted"], ["declined"]))).toBe(true);
  });

  it("does not wait when the client has an amendment to answer", () => {
    expect(clientWaitsOnTeam(view("in_progress", ["accepted"], ["pending"]))).toBe(false);
  });

  it("does not wait in the other statuses", () => {
    for (const status of ["awaiting_deposit", "delivered", "awaiting_balance", "completed", "cancelled", "declined", "expired"]) {
      expect(clientWaitsOnTeam(view(status, ["accepted"]))).toBe(false);
    }
  });
});

describe("isNotFoundError", () => {
  it("is true for a tRPC NOT_FOUND", () => {
    expect(isNotFoundError({ data: { code: "NOT_FOUND" } })).toBe(true);
  });

  it("is false for no error and for transient errors", () => {
    expect(isNotFoundError(null)).toBe(false);
    expect(isNotFoundError(undefined)).toBe(false);
    expect(isNotFoundError({ data: null })).toBe(false);
    expect(isNotFoundError({ data: { code: "INTERNAL_SERVER_ERROR" } })).toBe(false);
  });
});
