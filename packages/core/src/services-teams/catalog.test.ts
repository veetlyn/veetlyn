import { describe, expect, it } from "vitest";

import {
  departmentNameProblem,
  MAX_INTAKE_QUESTIONS,
  type OfferingDraft,
  validateOfferingDraft,
} from "./catalog";

const draft: OfferingDraft = {
  name: "Logo design",
  description: "Three concepts, two rounds of changes.",
  priceMinMinor: 10_000,
  priceMaxMinor: 40_000,
  daysMin: 2,
  daysMax: 5,
  intakeQuestions: ["What is the business called?", "Any colours to avoid?"],
};

const fields = (problems: { field: string }[]) => problems.map((p) => p.field);

describe("validateOfferingDraft", () => {
  it("accepts a complete service", () => {
    expect(validateOfferingDraft(draft)).toEqual([]);
  });

  it("needs a name and trims it", () => {
    expect(fields(validateOfferingDraft({ ...draft, name: "   " }))).toEqual(["name"]);
    expect(validateOfferingDraft({ ...draft, name: " Logo design " })[0]?.field).toBeUndefined();
  });

  it("rejects a name over 80 characters and a description over 1,000", () => {
    expect(fields(validateOfferingDraft({ ...draft, name: "x".repeat(81) }))).toEqual(["name"]);
    expect(fields(validateOfferingDraft({ ...draft, description: "x".repeat(1_001) }))).toEqual(["description"]);
  });

  it("rejects a price range that is the wrong way round, negative, or not a whole minor amount", () => {
    expect(fields(validateOfferingDraft({ ...draft, priceMinMinor: 50_000 }))).toEqual(["price"]);
    expect(fields(validateOfferingDraft({ ...draft, priceMinMinor: -1 }))).toEqual(["price"]);
    expect(fields(validateOfferingDraft({ ...draft, priceMaxMinor: 1.5 }))).toEqual(["price"]);
  });

  it("accepts a fixed price (min equals max)", () => {
    expect(validateOfferingDraft({ ...draft, priceMinMinor: 20_000, priceMaxMinor: 20_000 })).toEqual([]);
  });

  it("rejects days below 1, above 365, or the wrong way round", () => {
    expect(fields(validateOfferingDraft({ ...draft, daysMin: 0 }))).toEqual(["days"]);
    expect(fields(validateOfferingDraft({ ...draft, daysMax: 366 }))).toEqual(["days"]);
    expect(fields(validateOfferingDraft({ ...draft, daysMin: 6, daysMax: 5 }))).toEqual(["days"]);
  });

  it("allows up to five non-empty intake questions", () => {
    expect(validateOfferingDraft({ ...draft, intakeQuestions: [] })).toEqual([]);
    expect(
      validateOfferingDraft({ ...draft, intakeQuestions: Array.from({ length: MAX_INTAKE_QUESTIONS }, (_, i) => `Q${i}`) }),
    ).toEqual([]);
    expect(
      fields(
        validateOfferingDraft({
          ...draft,
          intakeQuestions: Array.from({ length: MAX_INTAKE_QUESTIONS + 1 }, (_, i) => `Q${i}`),
        }),
      ),
    ).toEqual(["intakeQuestions"]);
    expect(fields(validateOfferingDraft({ ...draft, intakeQuestions: ["  "] }))).toEqual(["intakeQuestions"]);
    expect(fields(validateOfferingDraft({ ...draft, intakeQuestions: ["x".repeat(201)] }))).toEqual([
      "intakeQuestions",
    ]);
  });

  it("trims the questions it accepts", () => {
    expect(validateOfferingDraft({ ...draft, intakeQuestions: ["  What is it for?  "] })).toEqual([]);
  });
});

describe("departmentNameProblem", () => {
  it("needs a name of at most 60 characters", () => {
    expect(departmentNameProblem("  Branding  ")).toBeNull();
    expect(departmentNameProblem("   ")).toBe("Give the department a name.");
    expect(departmentNameProblem("x".repeat(61))).toBe("Keep the department name under 60 characters.");
  });
});
