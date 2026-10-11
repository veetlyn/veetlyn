import { describe, expect, it } from "vitest";

import { checkoutEmailProblem, downloadsLeftLabel, grantMessage, orderTokenLooksValid } from "./checkout";

describe("checkoutEmailProblem", () => {
  it("accepts a plain address, with surrounding spaces", () => {
    expect(checkoutEmailProblem("buyer@example.com")).toBeNull();
    expect(checkoutEmailProblem("  buyer@example.com ")).toBeNull();
  });

  it("rejects empty, missing @, missing domain dot, and inner spaces", () => {
    const problem = "That email address does not look right.";
    expect(checkoutEmailProblem("")).toBe(problem);
    expect(checkoutEmailProblem("buyer.example.com")).toBe(problem);
    expect(checkoutEmailProblem("buyer@example")).toBe(problem);
    expect(checkoutEmailProblem("bu yer@example.com")).toBe(problem);
  });
});

describe("grantMessage", () => {
  it("says nothing for a usable grant on a paid order", () => {
    expect(grantMessage("usable", "paid")).toBeNull();
  });

  it("explains a refund, whether from the order status or a revoked grant", () => {
    const refunded = "This order was refunded, so the download is no longer available.";
    expect(grantMessage("usable", "refunded")).toBe(refunded);
    expect(grantMessage("expired", "refunded")).toBe(refunded);
    expect(grantMessage("revoked", "paid")).toBe(refunded);
  });

  it("explains an expired link", () => {
    expect(grantMessage("expired", "paid")).toBe("This link has expired. Ask for a new one and we'll email it to you.");
  });

  it("explains a used-up link", () => {
    expect(grantMessage("used_up", "paid")).toBe(
      "This link has no downloads left. Ask for a new one and we'll email it to you.",
    );
  });
});

describe("orderTokenLooksValid", () => {
  it("accepts tokens of 20 to 100 characters", () => {
    expect(orderTokenLooksValid("a".repeat(20))).toBe(true);
    expect(orderTokenLooksValid("a".repeat(43))).toBe(true);
    expect(orderTokenLooksValid("a".repeat(100))).toBe(true);
  });

  it("rejects shorter or longer tokens", () => {
    expect(orderTokenLooksValid("a".repeat(19))).toBe(false);
    expect(orderTokenLooksValid("a".repeat(101))).toBe(false);
  });
});

describe("downloadsLeftLabel", () => {
  it("uses the singular for one", () => {
    expect(downloadsLeftLabel(1)).toBe("1 download left");
    expect(downloadsLeftLabel(5)).toBe("5 downloads left");
  });
});
