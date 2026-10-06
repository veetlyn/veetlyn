import { describe, expect, it } from "vitest";

import { authErrorMessage, isEmailNotVerified, TOO_MANY_ATTEMPTS, verifyEmailPath } from "./auth-flow";

describe("auth flow helpers", () => {
  it("explains rate limits the same way everywhere", () => {
    expect(authErrorMessage({ status: 429, message: "Too many requests" }, "Fallback")).toBe(TOO_MANY_ATTEMPTS);
  });

  it("uses the server message, or the fallback when there is none", () => {
    expect(authErrorMessage({ status: 401, message: "Invalid email or password" }, "Fallback")).toBe(
      "Invalid email or password",
    );
    expect(authErrorMessage({ status: 500 }, "Fallback")).toBe("Fallback");
  });

  it("recognises an unverified email", () => {
    expect(isEmailNotVerified({ status: 403, code: "EMAIL_NOT_VERIFIED" })).toBe(true);
    expect(isEmailNotVerified({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" })).toBe(false);
  });

  it("builds the verify-email path with the address encoded", () => {
    expect(verifyEmailPath("ada+shop@example.com")).toBe("/verify-email?email=ada%2Bshop%40example.com");
  });
});
