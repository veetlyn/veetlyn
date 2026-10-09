import { describe, expect, it } from "vitest";

import { OPEN_PROJECT_STATUSES } from "../projects/state-machine";
import { validateQuoteRequest, type QuoteRequestDraft } from "./quote-request";

const valid: QuoteRequestDraft = {
  name: "Mouhamed Diop",
  email: "mouhamed@example.com",
  description: "I need a landing page.",
  answers: [
    { question: "Budget?", answer: "Around 2,000 USD" },
    { question: "Deadline?", answer: "End of next month" },
  ],
};

describe("validateQuoteRequest", () => {
  it("accepts a complete draft", () => {
    expect(validateQuoteRequest(valid)).toEqual([]);
  });

  it("needs a name", () => {
    expect(validateQuoteRequest({ ...valid, name: "   " })).toContain("Tell us your name.");
  });

  it("keeps the name under 80 characters", () => {
    expect(validateQuoteRequest({ ...valid, name: "n".repeat(81) })).toContain(
      "Keep your name under 80 characters.",
    );
  });

  it("needs an email address that looks right", () => {
    expect(validateQuoteRequest({ ...valid, email: "not-an-email" })).toContain(
      "That email address does not look right.",
    );
  });

  it("needs at least a sentence of description", () => {
    expect(validateQuoteRequest({ ...valid, description: "Too short" })).toContain(
      "Describe what you need in at least a sentence.",
    );
  });

  it("keeps the description under 2,000 characters", () => {
    expect(validateQuoteRequest({ ...valid, description: "d".repeat(2001) })).toContain(
      "Keep the description under 2,000 characters.",
    );
  });

  it("allows up to 5 answers", () => {
    const answers = Array.from({ length: 6 }, (_, i) => ({ question: `Q${i}?`, answer: `A${i}` }));
    expect(validateQuoteRequest({ ...valid, answers })).toContain("Answer up to 5 questions.");
  });

  it("needs every answered question answered", () => {
    const answers = [...valid.answers, { question: "Extra?", answer: "   " }];
    expect(validateQuoteRequest({ ...valid, answers })).toContain("Answer every question or remove it.");
  });
});

describe("OPEN_PROJECT_STATUSES", () => {
  it("lists the statuses where a project is still open", () => {
    expect(OPEN_PROJECT_STATUSES).toEqual([
      "quoting",
      "awaiting_deposit",
      "in_progress",
      "delivered",
      "awaiting_balance",
    ]);
  });
});
