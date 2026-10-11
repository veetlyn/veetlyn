import { hitRequestLimit } from "@jendal-workspace/db/repositories/request-limits";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { Context, PayPalServices } from "../context";
import { publicProcedure, router } from "../index";
import { captureCheckout, getCheckout, type OrderDeps, startCheckout, verifyCheckout } from "../use-cases/orders";

const slugInput = z.string().min(1).max(63);
// A uuid check keeps a malformed id a "not for sale" answer instead of a database error.
const productInput = z.object({ slug: slugInput, productId: z.uuid() });

function requirePayPal(paypal: PayPalServices | undefined): PayPalServices {
  if (!paypal) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "PayPal is not configured on this server." });
  return paypal;
}

function orderDeps(ctx: Context): OrderDeps {
  return { db: ctx.db, paypal: requirePayPal(ctx.paypal), email: ctx.email };
}

const TEN_MINUTES_MS = 600_000;

// Checkout is public: each start creates a PayPal order and each capture calls PayPal, so both are bounded.
async function limit(ctx: Context, key: string, max: number): Promise<void> {
  const allowed = await hitRequestLimit(ctx.db, { key, windowMs: TEN_MINUTES_MS, max });
  if (!allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many attempts. Wait a few minutes and try again." });
}

// Sellers design §5.2: guest checkout for a digital product. The amount always comes from the database.
export const checkoutRouter = router({
  get: publicProcedure
    .input(productInput)
    .query(({ ctx, input }) => getCheckout({ db: ctx.db, paypal: ctx.paypal }, input)),

  start: publicProcedure.input(productInput.extend({ email: z.string().max(400) })).mutation(async ({ ctx, input }) => {
    await limit(ctx, `checkout-start:ip:${ctx.headers.get("cf-connecting-ip") ?? "unknown"}`, 20);
    return startCheckout(orderDeps(ctx), input);
  }),

  capture: publicProcedure
    .input(z.object({ orderId: z.string().min(1).max(64), secret: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      // Checked first and keyed by the order, so guesses at another buyer's order cannot spend that buyer's attempts.
      const order = await verifyCheckout(ctx.db, { paypalOrderId: input.orderId, secret: input.secret });
      await limit(ctx, `checkout-capture:${order.id}`, 20);
      return captureCheckout(orderDeps(ctx), order);
    }),
});
