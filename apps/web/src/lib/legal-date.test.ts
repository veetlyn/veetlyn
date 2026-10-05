import { describe, expect, it } from "vitest";

import { formatLegalDate } from "./legal-date";

describe("formatLegalDate", () => {
  it("formats in UTC so the date does not shift by time zone", () => {
    expect(formatLegalDate(new Date("2026-10-05T23:30:00Z"))).toBe("October 5, 2026");
  });
});
