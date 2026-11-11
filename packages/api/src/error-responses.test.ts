import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { publicProcedure, router } from "./index";

// Staging 2026-11-11: a failed database update reached the browser as "Failed query: update ... params: <values>".
const testRouter = router({
  unexpected: publicProcedure.query(() => {
    throw new Error('Failed query: update "team" set "paypal_merchant_id" = $1\nparams: SECRET_VALUE');
  }),
  deliberate: publicProcedure.query(() => {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "We could not send the email. Try again in a few minutes." });
  }),
  refused: publicProcedure.query(() => {
    throw new TRPCError({ code: "CONFLICT", message: "Already connected." });
  }),
});

async function errorMessage(path: string): Promise<string> {
  const response = await fetchRequestHandler({
    endpoint: "/trpc",
    req: new Request(`https://api.test/trpc/${path}`),
    router: testRouter,
    // SAFETY: these procedures read nothing from the context.
    createContext: () => ({}) as never,
  });
  // SAFETY: tRPC answers every failed call with { error: { message } }; the tests read only that field.
  const body = (await response.json()) as { error: { message: string } };
  return body.error.message;
}

describe("error responses", () => {
  it("never send an unexpected error's own message, which can carry SQL and its values", async () => {
    const message = await errorMessage("unexpected");
    expect(message).not.toContain("Failed query");
    expect(message).not.toContain("SECRET_VALUE");
    expect(message).toBe("Something went wrong on our side. Try again in a moment.");
  });

  it("keep the words of errors the code raised on purpose", async () => {
    await expect(errorMessage("deliberate")).resolves.toBe("We could not send the email. Try again in a few minutes.");
    await expect(errorMessage("refused")).resolves.toBe("Already connected.");
  });
});
