// Output guard: an answer is read by a person, never by a program, so nothing internal may reach it. Tool results
// carry record ids, field names and raw timestamps; the model sometimes copies them into its prose. This strips
// them after the model answers and before the entry is stored, whatever the model did.
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// A shortened id the model wrote itself, like 0cf0ce75... — still an internal id.
const TRUNCATED_ID = /\b[0-9a-f]{6,}(?:\.\.\.|…)/gi;
// A short id in brackets, like (00fbf3ae).
const BRACKETED_ID = /\s*\([0-9a-f]{6,12}\)/gi;
// A field name carrying a bare value (canRate: true) goes as one piece, so no dangling ": true" is left behind.
const FIELD_VALUE = /\b[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*\s*[:=]\s*(?:true|false|null)\b/gi;
const ISO_TIMESTAMP = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?\b/g;
// Field paths (ratings.canRateClient). Only a path with a camelCase or snake_case part is a field: plain dotted words
// are web addresses (example.com, walk-crew.example.app) that the person needs.
const FIELD_PATH = /\b[a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)+\b/g;
const isFieldPath = (path: string) => /[A-Z_]/.test(path);
// Single field names in camelCase or snake_case (clientRating, amount_minor).
const FIELD_NAME = /\b(?:[a-z]+(?:[A-Z][a-zA-Z0-9]*)+|[a-z]+(?:_[a-z]+)+)\b/g;

export function sanitizeAgentAnswer(text: string): string {
  return text
    .replace(ISO_TIMESTAMP, (stamp) => {
      const date = new Date(stamp);
      return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });
    })
    .replace(UUID, "")
    .replace(TRUNCATED_ID, "")
    .replace(BRACKETED_ID, "")
    .replace(FIELD_VALUE, "")
    .replace(FIELD_PATH, (path) => (isFieldPath(path) ? "" : path))
    .replace(FIELD_NAME, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/\(\s+/g, "(")
    // A removed id between two dashes leaves “— —”; one dash stays.
    .replace(/([—–])(?:\s+[—–])+/g, "$1")
    .replace(/\s+[—–](?=\s*[.,;:!?)])/g, "")
    .replace(/``/g, "")
    .trim();
}
