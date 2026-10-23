import { describe, expect, it } from "vitest";

import { breaksLedgerInvariant, isLedgerAccountKey, ledgerAccountKind, ledgerAccounts } from "./accounts";

describe("ledger accounts", () => {
  it("names the accounts of services spec §6.2", () => {
    expect(ledgerAccounts.clientHeld("p1")).toBe("client_held:p1");
    expect(ledgerAccounts.owedAvailable("u1")).toBe("owed:u1:available");
    expect(ledgerAccounts.owedReserved("u1")).toBe("owed:u1:reserved");
    expect(ledgerAccounts.paidOut("u1")).toBe("paid_out:u1");
    expect([ledgerAccounts.teamRevenue, ledgerAccounts.clientRefunds, ledgerAccounts.paypalClearing]).toEqual([
      "team_revenue",
      "client_refunds",
      "paypal_clearing",
    ]);
    expect([ledgerAccounts.paypalFees, ledgerAccounts.platformFees]).toEqual(["paypal_fees", "platform_fees"]);
  });

  it("rejects ids that would make a key ambiguous", () => {
    expect(() => ledgerAccounts.clientHeld("")).toThrow("Invalid ledger account id");
    expect(() => ledgerAccounts.owedAvailable("a:b")).toThrow("Invalid ledger account id");
  });

  it.each([
    ["client_held:p1", "client_held"],
    ["team_revenue", "team_revenue"],
    ["owed:u1:available", "owed_available"],
    ["owed:u1:reserved", "owed_reserved"],
    ["paid_out:u1", "paid_out"],
    ["client_refunds", "client_refunds"],
    ["paypal_clearing", "paypal_clearing"],
    ["paypal_fees", "paypal_fees"],
    ["platform_fees", "platform_fees"],
    ["owed:u1:spent", null],
    ["client_held:", null],
    ["cash", null],
  ])("reads %j as %j", (key, kind) => {
    expect(ledgerAccountKind(key)).toBe(kind);
    expect(isLedgerAccountKey(key)).toBe(kind !== null);
  });

  it("keeps earnings, client money, payouts and refunds at or above zero (§6.1)", () => {
    expect(breaksLedgerInvariant("owed:u1:available", -1)).toBe(true);
    expect(breaksLedgerInvariant("owed:u1:reserved", -1)).toBe(true);
    expect(breaksLedgerInvariant("client_held:p1", -1)).toBe(true);
    expect(breaksLedgerInvariant("paid_out:u1", -1)).toBe(true);
    expect(breaksLedgerInvariant("client_refunds", -1)).toBe(true);
    expect(breaksLedgerInvariant("owed:u1:available", 0)).toBe(false);
    expect(breaksLedgerInvariant("team_revenue", -500)).toBe(false);
    expect(breaksLedgerInvariant("paypal_clearing", -60_000)).toBe(false);
  });
});
