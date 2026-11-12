import { describe, expect, it } from "vitest";

import { competingProposalCount, quoteAttribution } from "./quote-attribution";

const members = [
  { id: "aicha", name: "Aïcha Diop" },
  { id: "olu", name: "Olu Bello" },
];

describe("quoteAttribution", () => {
  it("names the freelancer who quoted for themselves once", () => {
    expect(quoteAttribution({ freelancerId: "aicha", authorId: "aicha" }, members)).toEqual({ quotedFor: "Aïcha Diop", preparedBy: null });
  });

  it("names both people when a manager prepared the quote for a freelancer", () => {
    expect(quoteAttribution({ freelancerId: "aicha", authorId: "olu" }, members)).toEqual({ quotedFor: "Aïcha Diop", preparedBy: "Olu Bello" });
  });

  it("does not invent an author when it was not recorded or the person left", () => {
    expect(quoteAttribution({ freelancerId: "aicha", authorId: null }, members)).toEqual({ quotedFor: "Aïcha Diop", preparedBy: null });
    expect(quoteAttribution({ freelancerId: "gone", authorId: "gone" }, members)).toEqual({ quotedFor: "A former member", preparedBy: null });
    expect(quoteAttribution({ freelancerId: "aicha", authorId: "gone" }, members)).toEqual({ quotedFor: "Aïcha Diop", preparedBy: "A former member" });
  });
});

describe("competingProposalCount", () => {
  it("counts open proposals from different freelancers", () => {
    expect(
      competingProposalCount([
        { status: "proposed", freelancerId: "aicha" },
        { status: "proposed", freelancerId: "olu" },
        { status: "proposed", freelancerId: "olu" },
        { status: "superseded", freelancerId: "sam" },
      ]),
    ).toBe(2);
    expect(competingProposalCount([{ status: "accepted", freelancerId: "aicha" }, { status: "proposed", freelancerId: "aicha" }])).toBe(1);
  });
});
