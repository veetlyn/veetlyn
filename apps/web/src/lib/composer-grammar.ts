// The word being completed at the caret: @ for a record, / for an action. Names can hold spaces, so a line can stay
// open for a while; it closes by itself once nothing matches.
export type ComposerTrigger = { kind: "@" | "/"; start: number; query: string };

const TRIGGER = /(?:^|\s)([@/])([^\n@/]{0,60})$/;

export function composerTrigger(text: string, caret: number): ComposerTrigger | null {
  const match = TRIGGER.exec(text.slice(0, caret));
  const kind = match?.[1];
  if (kind !== "@" && kind !== "/") return null;
  const query = match?.[2] ?? "";
  return { kind, query, start: caret - query.length - 1 };
}

export function applySuggestion(text: string, caret: number, trigger: ComposerTrigger, insert: string) {
  const value = text.slice(0, trigger.start) + insert + text.slice(caret);
  return { value, caret: trigger.start + insert.length };
}

// Titles are often the service's name, so a name several projects share carries the start of the id. The server reads it back.
export function mentionText(record: { id: string; title: string }, records: readonly { id: string; title: string }[]): string {
  const shared = records.some((other) => other.id !== record.id && other.title === record.title);
  return shared ? `@${record.title} #${record.id.slice(0, 4)} ` : `@${record.title} `;
}

export function matchesQuery(label: string, query: string): boolean {
  // A trailing space is kept: once a whole name is followed by a space, the person has moved on.
  return label.toLowerCase().includes(query.trimStart().toLowerCase());
}
