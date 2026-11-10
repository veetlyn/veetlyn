// Output guard: an answer is read by a person, never by a program, so nothing internal may reach it. Tool results
// carry record ids, field names and raw timestamps; the model sometimes copies them into its prose. This strips
// them after the model answers and before the entry is stored, whatever the model did.
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const ISO_TIMESTAMP = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?\b/g;
// Field paths (ratings.canRateClient) and single field names in camelCase or snake_case (clientRating, amount_minor).
const FIELD_PATH = /\b[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+\b/g;
const FIELD_NAME = /\b(?:[a-z]+(?:[A-Z][a-zA-Z0-9]*)+|[a-z]+(?:_[a-z]+)+)\b/g;

export function sanitizeAgentAnswer(text: string): string {
  return text
    .replace(ISO_TIMESTAMP, (stamp) => {
      const date = new Date(stamp);
      return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });
    })
    .replace(UUID, "")
    .replace(FIELD_PATH, "")
    .replace(FIELD_NAME, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .trim();
}
