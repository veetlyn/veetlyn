export function errorName(cause: unknown): string {
  return cause instanceof Error ? cause.name : "NonError";
}
