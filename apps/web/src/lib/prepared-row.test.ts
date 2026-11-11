import { describe, expect, it } from "vitest";

import { preparedRow } from "./prepared-row";

const quote = {
  kind: "quote" as const,
  title: "Quote for Landing page",
  cta: "Send quote",
  project: "Landing page",
  lines: [{ label: "Design", amount: "$640.00" }],
  total: "$640.00",
  delivery: "5 days",
  freelancer: null,
  deposit: { percent: 50, quotePart: "$320.00", managementFee: null, total: "$320.00" },
};

describe("preparedRow", () => {
  it("leads a quote with the client, then the project, timing and price", () => {
    expect(preparedRow(quote, "Rita")).toEqual({
      title: "Rita",
      detail: "Landing page · Quote, 5 days delivery",
      amount: "$640.00",
      action: "Review quote",
    });
  });

  it("falls back to the project when no client is known, without repeating it", () => {
    expect(preparedRow(quote, null)).toMatchObject({ title: "Landing page", detail: "Quote, 5 days delivery" });
  });

  it("names the payout decision the review opens", () => {
    const payout = { kind: "payout" as const, title: "Approve payout to Sam", cta: "Approve $90.00", decision: "approve" as const, member: "Sam", amount: "$90.00" };
    expect(preparedRow(payout, null)).toEqual({ title: "Sam", detail: "Payout to approve", amount: "$90.00", action: "Review payout" });
  });
});
