import { describe, expect, it } from "vitest";
import { waitlistEntryEmail } from "./templates";

describe("waitlist alert email", () => {
  it("includes consent context, address and UTC time in both formats and escapes HTML", () => {
    const content = waitlistEntryEmail({ platformName: "A & B\r\nName", email: "<script>@example.com", joinedAt: new Date("2026-11-02T17:43:07Z") });
    expect(content.subject).not.toMatch(/[\r\n]/);
    expect(content.text).toContain("2026-11-02 17:43:07 UTC");
    expect(content.text).toContain("launch notification");
    expect(content.html).toContain("&lt;script&gt;@example.com");
    expect(content.html).toContain("A &amp; B");
    expect(content.html).not.toContain("<script>");
  });
});
