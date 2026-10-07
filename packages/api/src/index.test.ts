import { describe, expect, it } from "vitest";

import { t } from "./index";

describe("tRPC setup", () => {
  // Without it tRPC guesses from NODE_ENV, which Workers may leave unset, and every error response
  // carries a stack trace. Server logs keep the stack (trpc-error-log).
  it("never sends stack traces to clients", () => {
    expect(t._config.isDev).toBe(false);
  });
});
