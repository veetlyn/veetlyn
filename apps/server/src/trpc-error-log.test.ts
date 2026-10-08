import { PayPalError } from "@jendal-workspace/paypal";
import { TRPCError } from "@trpc/server";
import { createRequestLogger } from "evlog";
import { describe, expect, it } from "vitest";

import { trpcErrorContext } from "./trpc-error-log";

describe("trpcErrorContext", () => {
  it("skips client errors, which the caller already sees", () => {
    expect(trpcErrorContext(new TRPCError({ code: "BAD_REQUEST", message: "nope" }), "store.create")).toBeNull();
  });

  it("names the procedure and the cause of a server error", () => {
    const cause = new Error("database is down");
    const context = trpcErrorContext(new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause }), "store.create");
    expect(context).toEqual({ error: cause, fields: { trpc: { path: "store.create", code: "INTERNAL_SERVER_ERROR" } } });
  });

  it("adds PayPal's status, debug id and detail issues, without the detail values", () => {
    const cause = new PayPalError({
      status: 422,
      name: "UNPROCESSABLE_ENTITY",
      message: "failed business validation",
      debugId: "f751607dcec18",
      details: [
        {
          field: "/operations/0/third_party_details/features/5",
          value: "seller@example.com",
          issue: "FEATURES_UNAUTHORIZED",
          description: "The requested feature is not configured on the REST app in the account",
        },
      ],
    });
    const context = trpcErrorContext(new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause }), "paypal.startOnboarding");
    expect(context?.fields.paypal).toEqual({
      status: 422,
      name: "UNPROCESSABLE_ENTITY",
      debugId: "f751607dcec18",
      details: [{ issue: "FEATURES_UNAUTHORIZED", field: "/operations/0/third_party_details/features/5" }],
    });
    expect(JSON.stringify(context?.fields)).not.toContain("seller@example.com");
  });

  it("logs a client error caused by PayPal, so a declined card keeps its debug_id", () => {
    const cause = new PayPalError({
      status: 422,
      message: "The instrument presented was declined.",
      debugId: "d422",
      name: "UNPROCESSABLE_ENTITY",
      details: [{ issue: "INSTRUMENT_DECLINED", description: "Declined", value: "secret-ish" }],
    });

    const context = trpcErrorContext(new TRPCError({ code: "UNPROCESSABLE_CONTENT", cause }), "payment.payCapture");

    expect(context).toEqual({
      error: cause,
      fields: {
        trpc: { path: "payment.payCapture", code: "UNPROCESSABLE_CONTENT" },
        paypal: {
          status: 422,
          name: "UNPROCESSABLE_ENTITY",
          debugId: "d422",
          details: [{ issue: "INSTRUMENT_DECLINED", field: undefined }],
        },
      },
    });
  });

  it("emits a PayPal error through evlog without its detail values", () => {
    const cause = new PayPalError({
      status: 422,
      message: "The instrument presented was declined.",
      debugId: "d422",
      name: "UNPROCESSABLE_ENTITY",
      details: [
        { issue: "INSTRUMENT_DECLINED", field: "/payment_source", value: "4111111111111111", description: "secret detail" },
      ],
    });
    const context = trpcErrorContext(new TRPCError({ code: "UNPROCESSABLE_CONTENT", cause }), "payment.payCapture");
    if (!context) throw new Error("expected a log context for a PayPal error");

    const logger = createRequestLogger({ method: "POST", path: "/trpc/payment.payCapture" });
    logger.error(context.error, context.fields);
    const emitted = JSON.stringify(logger.emit());

    expect(emitted).toContain("INSTRUMENT_DECLINED");
    expect(emitted).toContain("d422");
    expect(emitted).not.toContain("4111111111111111");
    expect(emitted).not.toContain("secret detail");
  });
});
