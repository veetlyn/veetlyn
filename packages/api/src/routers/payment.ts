import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { linkSecret, signClientLink, verifyPayLink } from "../client-links";
import type { Context, PayPalServices } from "../context";
import { publicProcedure, router } from "../index";
import { capturePayment, getPayPage, startPayment } from "../use-cases/payments";

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

// The pay page (services spec §5.4): a signed link, no account. The amount always comes from the database.
export const paymentRouter = router({
  payGet: publicProcedure.input(tokenInput).query(async ({ ctx, input }) => {
    const paymentId = await paymentIdFromToken(ctx.auth, input.token);
    const page = await getPayPage({ db: ctx.db, paypal: ctx.paypal }, paymentId);
    return { ...page, clientPath: `/c/${await signClientLink(linkSecret(ctx.auth), page.project.id)}` };
  }),

  payStart: publicProcedure.input(tokenInput).mutation(async ({ ctx, input }) => {
    const paymentId = await paymentIdFromToken(ctx.auth, input.token);
    return startPayment({ db: ctx.db, paypal: requirePayPal(ctx.paypal) }, paymentId);
  }),

  payCapture: publicProcedure
    .input(tokenInput.extend({ orderId: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const paymentId = await paymentIdFromToken(ctx.auth, input.token);
      return capturePayment({ db: ctx.db, paypal: requirePayPal(ctx.paypal) }, { paymentId, orderId: input.orderId });
    }),
});
