import { describe, expect, it } from "vitest";

import { HIDDEN_CONTACT, maskContactDetails } from "./masking";

const H = HIDDEN_CONTACT;

// Conversations design §6: each example is a way a freelancer or client could take the work off the platform
// before a quote is accepted, or a link the brief needs that must survive.
const MASKED: [string, string, string][] = [
  ["a plain email", "Write to me at aicha.d@gmail.com please", `Write to me at ${H} please`],
  ["an email in capitals with a plus tag", "AICHA+work@Studio.CO", H],
  ["an international phone number", "Call +221 77 123 45 67 tonight", `Call ${H} tonight`],
  ["a phone number written without spaces", "my number 771234567", `my number ${H}`],
  ["a phone number with dashes and brackets", "(415) 555-0134", H],
  ["a WhatsApp short link", "ping wa.me/221771234567", `ping ${H}`],
  ["a Telegram link with https", "https://t.me/aicha_designs", H],
  ["a Discord invite", "join discord.gg/abcd1234", `join ${H}`],
  ["a LinkedIn profile with tracking parameters", "https://www.linkedin.com/in/aicha?utm_source=x", H],
  ["a Fiverr gig", "see fiverr.com/aicha/logo", `see ${H}`],
  ["a Calendly booking page", "book calendly.com/aicha/30min.", `book ${H}.`],
  ["an Instagram handle link", "instagram.com/aicha.design", H],
];

const PASSED: [string, string][] = [
  ["a file link", "Logo files: https://storage.example.com/files/v1.png"],
  ["a Figma file", "https://www.figma.com/file/abc123/Logo"],
  ["a Drive folder", "drive.google.com/drive/folders/1AbC"],
  ["ordinary prose with numbers", "I need 3 logos in 5 days for $400, version 2.1"],
  ["a date and a price", "Deadline 2026-11-04, budget 1500"],
];

describe("maskContactDetails", () => {
  for (const [label, input, shown] of MASKED) {
    it(`hides ${label}`, () => {
      expect(maskContactDetails(input)).toEqual({ shown, masked: true });
    });
  }
  for (const [label, input] of PASSED) {
    it(`keeps ${label}`, () => {
      expect(maskContactDetails(input)).toEqual({ shown: input, masked: false });
    });
  }
  it("hides every match in one message", () => {
    expect(maskContactDetails("a@b.io or +33 6 12 34 56 78 or t.me/x, files at dropbox.com/s/1").shown).toBe(
      `${H} or ${H} or ${H}, files at dropbox.com/s/1`,
    );
  });
});
