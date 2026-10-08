// Sellers design §4.1: the service catalog. The same rules run in the browser before submit and in the API
// as a backstop, as validateProductDraft does for stores.

export const MAX_DEPARTMENT_NAME = 60;
export const MAX_OFFERING_NAME = 80;
export const MAX_OFFERING_DESCRIPTION = 1_000;
export const MAX_INTAKE_QUESTIONS = 5;
export const MAX_INTAKE_QUESTION_CHARS = 200;
// A quote's delivery time is capped at the same 365 days (packages/api/src/use-cases/projects.ts).
export const MAX_OFFERING_DAYS = 365;
export const MAX_OFFERING_PRICE_MINOR = 99_999_999;

export type OfferingDraft = {
  name: string;
  description: string;
  priceMinMinor: number;
  priceMaxMinor: number;
  daysMin: number;
  daysMax: number;
  intakeQuestions: string[];
};

export type OfferingProblem = { field: string; message: string };

function isWholeMinor(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_OFFERING_PRICE_MINOR;
}

function isWholeDays(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_OFFERING_DAYS;
}

export function validateOfferingDraft(draft: OfferingDraft): OfferingProblem[] {
  const problems: OfferingProblem[] = [];
  const name = draft.name.trim();
  if (!name) problems.push({ field: "name", message: "Give the service a name." });
  else if (name.length > MAX_OFFERING_NAME) {
    problems.push({ field: "name", message: `Keep the name under ${MAX_OFFERING_NAME} characters.` });
  }
  if (draft.description.length > MAX_OFFERING_DESCRIPTION) {
    problems.push({ field: "description", message: `Keep the description under ${MAX_OFFERING_DESCRIPTION} characters.` });
  }
  if (!isWholeMinor(draft.priceMinMinor) || !isWholeMinor(draft.priceMaxMinor)) {
    problems.push({ field: "price", message: "Enter both prices as amounts, for example 150 or 19.99." });
  } else if (draft.priceMaxMinor < draft.priceMinMinor) {
    problems.push({ field: "price", message: "The top of the range cannot be below its bottom." });
  }
  if (!isWholeDays(draft.daysMin) || !isWholeDays(draft.daysMax)) {
    problems.push({ field: "days", message: `Usual days are whole numbers from 1 to ${MAX_OFFERING_DAYS}.` });
  } else if (draft.daysMax < draft.daysMin) {
    problems.push({ field: "days", message: "The longest time cannot be shorter than the shortest." });
  }
  if (draft.intakeQuestions.length > MAX_INTAKE_QUESTIONS) {
    problems.push({ field: "intakeQuestions", message: `Ask up to ${MAX_INTAKE_QUESTIONS} questions.` });
  } else if (
    draft.intakeQuestions.some((question) => {
      const trimmed = question.trim();
      return !trimmed || trimmed.length > MAX_INTAKE_QUESTION_CHARS;
    })
  ) {
    problems.push({
      field: "intakeQuestions",
      message: `Every question needs text, up to ${MAX_INTAKE_QUESTION_CHARS} characters.`,
    });
  }
  return problems;
}

// The draft with its text fields trimmed, ready to store.
export function normalizeOfferingDraft(draft: OfferingDraft): OfferingDraft {
  return {
    ...draft,
    name: draft.name.trim(),
    description: draft.description.trim(),
    intakeQuestions: draft.intakeQuestions.map((question) => question.trim()).filter((question) => question !== ""),
  };
}

export function departmentNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give the department a name.";
  if (trimmed.length > MAX_DEPARTMENT_NAME) return `Keep the department name under ${MAX_DEPARTMENT_NAME} characters.`;
  return null;
}
