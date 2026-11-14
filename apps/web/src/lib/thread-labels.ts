// Threads are named after their first question, so a person who asks the same thing twice gets two threads with one
// name. A name that repeats in the list carries when its thread was opened: the time today, the date before, and the
// date with the time when two of them share a day.
export function threadWhen(
  calls: readonly { id: string; title: string; openedAt: string | Date }[],
  now: Date = new Date(),
): Map<string, string> {
  const repeats = calls.filter((call) => calls.some((other) => other !== call && other.title === call.title));
  const day = (call: { openedAt: string | Date }) => new Date(call.openedAt).toDateString();
  const when = new Map<string, string>();
  for (const call of repeats) {
    const opened = new Date(call.openedAt);
    const time = opened.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const date = opened.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const sharesDay = repeats.some((other) => other !== call && other.title === call.title && day(other) === day(call));
    when.set(call.id, day(call) === now.toDateString() ? time : sharesDay ? `${date}, ${time}` : date);
  }
  return when;
}
