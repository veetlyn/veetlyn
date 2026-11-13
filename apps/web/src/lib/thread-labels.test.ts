import { expect, it } from "vitest";

import { threadWhen } from "./thread-labels";

const now = new Date("2026-11-13T15:00:00");
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

it("tells repeated thread names apart by when they were opened, and leaves unique names alone", () => {
  const when = threadWhen(
    [
      { id: "today", title: "What needs me today?", openedAt: "2026-11-13T09:30:00" },
      { id: "earlier", title: "What needs me today?", openedAt: "2026-11-10T09:30:00" },
      { id: "once", title: "Quote for Something else", openedAt: "2026-11-13T10:00:00" },
    ],
    now,
  );
  expect(when.get("today")).toBe(time("2026-11-13T09:30:00"));
  expect(when.get("earlier")).toBe(date("2026-11-10T09:30:00"));
  expect(when.has("once")).toBe(false);
});

it("adds the time when two threads with one name were opened on the same past day", () => {
  const when = threadWhen(
    [
      { id: "morning", title: "What needs me today?", openedAt: "2026-11-12T09:30:00" },
      { id: "evening", title: "What needs me today?", openedAt: "2026-11-12T18:05:00" },
    ],
    now,
  );
  expect(when.get("morning")).toBe(`${date("2026-11-12T09:30:00")}, ${time("2026-11-12T09:30:00")}`);
  expect(when.get("evening")).not.toBe(when.get("morning"));
});
