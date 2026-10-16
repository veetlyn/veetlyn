import { hitRequestLimit } from "@jendal-workspace/db/repositories/request-limits";
import { PayPalError } from "@jendal-workspace/paypal";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { linkSecret, verifyPayLink } from "../client-links";
import type { Context, PayPalServices } from "../context";
import { publicProcedure, router } from "../index";
import { primaryClientPath } from "../use-cases/clients";
import { capturePayment, getPayPage, startPayment, unconfirmedCapture } from "../use-cases/payments";

const tokenInput = z.object({ token: z.string().min(1).max(200) });

async function paymentIdFromToken(auth: Context["auth"], token: string): Promise<string> {
  const paymentId = await verifyPayLink(linkSecret(auth), token);
  if (!paymentId) throw new TRPCError({ code: "NOT_FOUND", message: "This link is not valid." });
  return paymentId;
}

function requirePayPal(paypal: PayPalServices | undefined): PayPalServices {
  if (!paypal) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "PayPal is not configured on this server." });
  return paypal;
}

const TEN_MINUTES_MS = 600_000;

// Each start asks PayPal about the order and may create one; each capture calls PayPal. A pay link is
// public, so its holder gets a bounded number of each.
async function limitPayment(ctx: Context, action: "start" | "capture", paymentId: string): Promise<void> {
  const allowed = await hitRequestLimit(ctx.db, {
    key: `pay-${action}:${paymentId}`,
    windowMs: TEN_MINUTES_MS,
    max: action === "start" ? 10 : 20,
  });
  if (!allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many attempts. Wait a few minutes and try again." });
}

// The pay page (services spec §5.4): a signed link, no account. The amount always comes from the database.
export const paymentRouter = router({
  payGet: publicProcedure.input(tokenInput).query(async ({ ctx, input }) => {
    const paymentId = await paymentIdFromToken(ctx.auth, input.token);
    const page = await getPayPage({ db: ctx.db, paypal: ctx.paypal }, paymentId);
    return { ...page, clientPath: await primaryClientPath(ctx.db, linkSecret(ctx.auth), page.project.id) };
  }),

  payStart: publicProcedure.input(tokenInput).mutation(async ({ ctx, input }) => {
    const paymentId = await paymentIdFromToken(ctx.auth, input.token);
    await limitPayment(ctx, "start", paymentId);
    return startPayment({ db: ctx.db, paypal: requirePayPal(ctx.paypal) }, paymentId);
  }),

  payCapture: publicProcedure
    .input(tokenInput.extend({ orderId: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const paymentId = await paymentIdFromToken(ctx.auth, input.token);
      await limitPayment(ctx, "capture", paymentId);
      try {
        return await capturePayment({ db: ctx.db, paypal: requirePayPal(ctx.paypal) }, { paymentId, orderId: input.orderId });
      } catch (error) {
        if (error instanceof PayPalError) throw unconfirmedCapture(error);
        throw error;
      }
    }),
});
