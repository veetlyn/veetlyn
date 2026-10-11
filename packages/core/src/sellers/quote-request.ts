// Sellers design §4.2: the quote request form on the seller page.
export type QuoteRequestAnswer = { question: string; answer: string };

export type QuoteRequestDraft = {
  name: string;
  email: string;
  description: string;
  answers: QuoteRequestAnswer[];
};

export const QUOTE_REQUEST_LIMITS = {
  maxName: 80,
  maxEmail: 320,
  minDescription: 10,
  maxDescription: 2000,
  maxAnswers: 5,
  maxAnswer: 1000,
  openPerEmailPerTeam: 3,
} as const;

export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function validateQuoteRequest(draft: QuoteRequestDraft): string[] {
  const problems: string[] = [];
  const name = draft.name.trim();
  if (name.length === 0) problems.push("Tell us your name.");
  else if (name.length > QUOTE_REQUEST_LIMITS.maxName) {
    problems.push(`Keep your name under ${QUOTE_REQUEST_LIMITS.maxName} characters.`);
  }
  const email = draft.email.trim();
  if (!EMAIL_PATTERN.test(email) || email.length > QUOTE_REQUEST_LIMITS.maxEmail) {
    problems.push("That email address does not look right.");
  }
  const description = draft.description.trim();
  if (description.length < QUOTE_REQUEST_LIMITS.minDescription) {
    problems.push("Describe what you need in at least a sentence.");
  } else if (description.length > QUOTE_REQUEST_LIMITS.maxDescription) {
    problems.push("Keep the description under 2,000 characters.");
  }
  if (draft.answers.length > QUOTE_REQUEST_LIMITS.maxAnswers) {
    problems.push(`Answer up to ${QUOTE_REQUEST_LIMITS.maxAnswers} questions.`);
  }
  for (const { answer } of draft.answers) {
    const trimmed = answer.trim();
    if (trimmed.length === 0) problems.push("Answer every question or remove it.");
    else if (trimmed.length > QUOTE_REQUEST_LIMITS.maxAnswer) {
      problems.push("Keep each answer under 1,000 characters.");
    }
  }
  return problems;
}
