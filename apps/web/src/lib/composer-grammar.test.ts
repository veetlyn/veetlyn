import { describe, expect, it } from "vitest";

import { applySuggestion, composerTrigger, matchesQuery, mentionText } from "./composer-grammar";

describe("composerTrigger", () => {
  it("opens at the start of a line or after a space, and reads the name so far", () => {
    expect(composerTrigger("@", 1)).toEqual({ kind: "@", start: 0, query: "" });
    expect(composerTrigger("Quote @Logo re", 14)).toEqual({ kind: "@", start: 6, query: "Logo re" });
    expect(composerTrigger("/pre", 4)).toEqual({ kind: "/", start: 0, query: "pre" });
  });

  it("stays shut inside addresses, paths and earlier lines", () => {
    expect(composerTrigger("mail me at jo@acme.com", 22)).toBeNull();
    expect(composerTrigger("and/or", 6)).toBeNull();
    expect(composerTrigger("@Logo\nthanks", 12)).toBeNull();
  });

  it("reads only up to the caret", () => {
    expect(composerTrigger("@Logo and more", 5)).toEqual({ kind: "@", start: 0, query: "Logo" });
  });
});

it("replaces the typed word, keeps what follows, and puts the caret after the insert", () => {
  const text = "Quote @Lo for Friday";
  const trigger = composerTrigger(text, 9);
  if (!trigger) throw new Error("expected a trigger");
  expect(applySuggestion(text, 9, trigger, "@Logo refresh ")).toEqual({ value: "Quote @Logo refresh  for Friday", caret: 20 });
});

it("matches any part of a name, whatever the case", () => {
  expect(matchesQuery("Logo refresh", "REFR")).toBe(true);
  expect(matchesQuery("Logo refresh", "site")).toBe(false);
});

it("closes once a whole name is followed by a space", () => {
  expect(matchesQuery("Logo refresh", "Logo refresh")).toBe(true);
  expect(matchesQuery("Logo refresh", "Logo refresh ")).toBe(false);
});

it("tags a name only when another project shares it", () => {
  const records = [{ id: "abcd-1", title: "Logo" }, { id: "ef01-2", title: "Logo" }, { id: "9999-3", title: "Site" }];
  expect(mentionText(records[0]!, records)).toBe("@Logo #abcd ");
  expect(mentionText(records[2]!, records)).toBe("@Site ");
});
