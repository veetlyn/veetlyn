import { describe, expect, it } from "vitest";

import { type SenderKey, senderAddress } from "./senders";

describe("senderAddress", () => {
  it.each<[SenderKey, string, string]>([
    ["accounts", "accounts@platform.test", "Platform"],
    ["stores", "stores@platform.test", "Platform Stores"],
    ["invoices", "invoices@platform.test", "Platform Invoices"],
    ["payouts", "payouts@platform.test", "Platform Payouts"],
    ["disputes", "disputes@platform.test", "Platform Disputes"],
    ["billing", "billing@platform.test", "Platform Billing"],
  ])("sends %s mail from %s as %s", (key, email, name) => {
    expect(senderAddress(key, "platform.test", "Platform")).toEqual({ email, name });
  });

  it("uses the configured domain, lowercased", () => {
    expect(senderAddress("accounts", "Mail.Example.COM", "Platform")).toEqual({
      email: "accounts@mail.example.com",
      name: "Platform",
    });
  });

  it("names the party it sends for", () => {
    expect(senderAddress("stores", "platform.test", "Platform", "Ada's Shop")).toEqual({
      email: "stores@platform.test",
      name: "Ada's Shop via Platform",
    });
  });

  it("strips line breaks and control characters so the name cannot inject headers", () => {
    const { name } = senderAddress("stores", "platform.test", "Platform", "Shop\r\nBcc: victim@example.com\u0000\u202e");

    expect(name).toBe("Shop Bcc victim example.com via Platform");
  });

  it('strips quotes, angle brackets and the other address characters "<>@,;:\\()[]', () => {
    const { name } = senderAddress("invoices", "platform.test", "Platform", '"Acme" <billing@paypal.com>, (Team); [x]: \\y');

    expect(name).toBe("Acme billing paypal.com Team x y via Platform");
  });

  it("collapses whitespace and trims", () => {
    expect(senderAddress("stores", "platform.test", "Platform", "  Ada \t  Shop  ").name).toBe("Ada Shop via Platform");
  });

  it("caps the party name at 64 characters", () => {
    const { name } = senderAddress("stores", "platform.test", "Platform", "a".repeat(100));

    expect(name).toBe(`${"a".repeat(64)} via Platform`);
  });

  it("falls back to the sender name when nothing usable is left", () => {
    expect(senderAddress("invoices", "platform.test", "Platform", ' <@> "\r\n ').name).toBe("Platform Invoices");
    expect(senderAddress("invoices", "platform.test", "Platform", "").name).toBe("Platform Invoices");
  });

  it.each(["", "platform", "platform.test>", "a@platform.test", "platform.test\r\nBcc: x", "-platform.test", "platform..com"])(
    "rejects the domain %j",
    (domain) => {
      expect(() => senderAddress("accounts", domain, "Platform")).toThrow(/EMAIL_DOMAIN/);
    },
  );
});
