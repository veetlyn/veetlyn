import { describe, expect, it } from "vitest";

import { type SenderKey, senderAddress } from "./senders";

describe("senderAddress", () => {
  it.each<[SenderKey, string, string]>([
    ["accounts", "accounts@payleor.com", "Platform"],
    ["stores", "stores@payleor.com", "Platform Stores"],
    ["invoices", "invoices@payleor.com", "Platform Invoices"],
    ["payouts", "payouts@payleor.com", "Platform Payouts"],
    ["disputes", "disputes@payleor.com", "Platform Disputes"],
    ["billing", "billing@payleor.com", "Platform Billing"],
  ])("sends %s mail from %s as %s", (key, email, name) => {
    expect(senderAddress(key, "payleor.com", "Platform")).toEqual({ email, name });
  });

  it("uses the configured domain, lowercased", () => {
    expect(senderAddress("accounts", "Mail.Example.COM", "Platform")).toEqual({
      email: "accounts@mail.example.com",
      name: "Platform",
    });
  });

  it("names the party it sends for", () => {
    expect(senderAddress("stores", "payleor.com", "Platform", "Ada's Shop")).toEqual({
      email: "stores@payleor.com",
      name: "Ada's Shop via Platform",
    });
  });

  it("strips line breaks and control characters so the name cannot inject headers", () => {
    const { name } = senderAddress("stores", "payleor.com", "Platform", "Shop\r\nBcc: victim@example.com\u0000\u202e");

    expect(name).toBe("Shop Bcc victim example.com via Platform");
  });

  it('strips quotes, angle brackets and the other address characters "<>@,;:\\()[]', () => {
    const { name } = senderAddress("invoices", "payleor.com", "Platform", '"Acme" <billing@paypal.com>, (Team); [x]: \\y');

    expect(name).toBe("Acme billing paypal.com Team x y via Platform");
  });

  it("collapses whitespace and trims", () => {
    expect(senderAddress("stores", "payleor.com", "Platform", "  Ada \t  Shop  ").name).toBe("Ada Shop via Platform");
  });

  it("caps the party name at 64 characters", () => {
    const { name } = senderAddress("stores", "payleor.com", "Platform", "a".repeat(100));

    expect(name).toBe(`${"a".repeat(64)} via Platform`);
  });

  it("falls back to the sender name when nothing usable is left", () => {
    expect(senderAddress("invoices", "payleor.com", "Platform", ' <@> "\r\n ').name).toBe("Platform Invoices");
    expect(senderAddress("invoices", "payleor.com", "Platform", "").name).toBe("Platform Invoices");
  });

  it.each(["", "payleor", "payleor.com>", "a@payleor.com", "payleor.com\r\nBcc: x", "-payleor.com", "payleor..com"])(
    "rejects the domain %j",
    (domain) => {
      expect(() => senderAddress("accounts", domain, "Platform")).toThrow(/EMAIL_DOMAIN/);
    },
  );
});
