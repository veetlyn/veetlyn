import { describe, expect, it } from "vitest";

import { type SenderKey, senderAddress } from "./senders";

describe("senderAddress", () => {
  it.each<[SenderKey, string, string]>([
    ["accounts", "accounts@payleor.com", "Payleor"],
    ["stores", "stores@payleor.com", "Payleor Stores"],
    ["invoices", "invoices@payleor.com", "Payleor Invoices"],
    ["payouts", "payouts@payleor.com", "Payleor Payouts"],
    ["disputes", "disputes@payleor.com", "Payleor Disputes"],
    ["billing", "billing@payleor.com", "Payleor Billing"],
  ])("sends %s mail from %s as %s", (key, email, name) => {
    expect(senderAddress(key, "payleor.com")).toEqual({ email, name });
  });

  it("uses the configured domain, lowercased", () => {
    expect(senderAddress("accounts", "Mail.Example.COM")).toEqual({
      email: "accounts@mail.example.com",
      name: "Payleor",
    });
  });

  it("names the party it sends for", () => {
    expect(senderAddress("stores", "payleor.com", "Ada's Shop")).toEqual({
      email: "stores@payleor.com",
      name: "Ada's Shop via Payleor",
    });
  });

  it("strips line breaks and control characters so the name cannot inject headers", () => {
    const { name } = senderAddress("stores", "payleor.com", "Shop\r\nBcc: victim@example.com\u0000\u202e");

    expect(name).toBe("Shop Bcc victim example.com via Payleor");
  });

  it('strips quotes, angle brackets and the other address characters "<>@,;:\\()[]', () => {
    const { name } = senderAddress("invoices", "payleor.com", '"Acme" <billing@paypal.com>, (Team); [x]: \\y');

    expect(name).toBe("Acme billing paypal.com Team x y via Payleor");
  });

  it("collapses whitespace and trims", () => {
    expect(senderAddress("stores", "payleor.com", "  Ada \t  Shop  ").name).toBe("Ada Shop via Payleor");
  });

  it("caps the party name at 64 characters", () => {
    const { name } = senderAddress("stores", "payleor.com", "a".repeat(100));

    expect(name).toBe(`${"a".repeat(64)} via Payleor`);
  });

  it("falls back to the sender name when nothing usable is left", () => {
    expect(senderAddress("invoices", "payleor.com", ' <@> "\r\n ').name).toBe("Payleor Invoices");
    expect(senderAddress("invoices", "payleor.com", "").name).toBe("Payleor Invoices");
  });

  it.each(["", "payleor", "payleor.com>", "a@payleor.com", "payleor.com\r\nBcc: x", "-payleor.com", "payleor..com"])(
    "rejects the domain %j",
    (domain) => {
      expect(() => senderAddress("accounts", domain)).toThrow(/EMAIL_DOMAIN/);
    },
  );
});
