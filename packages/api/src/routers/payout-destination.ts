import { payoutAgeFromUserInfo, payoutDestinationFromUserInfo } from "@jendal-workspace/core";
import {
  confirmPayoutDestinationAge,
  deletePayoutDestination,
  findLinkedPayPalAccount,
  getPayoutDestination,
  type PayoutAgeSource,
  type PayoutDestinationRecord,
  savePayoutDestination,
} from "@jendal-workspace/db/repositories/payouts";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { fetchPayPalUserInfo } from "../paypal-userinfo";

// tRPC has no transformer here, so dates are returned as ISO strings (as servicesTeam.get does).
function toDestinationView(record: PayoutDestinationRecord) {
  return {
    paypalPayerId: record.paypalPayerId,
    paypalEmail: record.paypalEmail,
    verifiedAt: record.verifiedAt.toISOString(),
    ageConfirmed: record.ageConfirmedAt !== null,
  };
}

function unconfirmed(): TRPCError {
  return new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "PayPal did not confirm your payer ID. Connect PayPal again.",
  });
}

const connectInput = z.object({ confirmAdult: z.boolean().default(false) }).default({ confirmAdult: false });

export const payoutDestinationRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const destination = await getPayoutDestination(ctx.db, ctx.session.user.id);
    return destination ? toDestinationView(destination) : null;
  }),

  // Runs after "Log in with PayPal" returns the user to /me/payouts. The payer ID and email come only
  // from PayPal's userinfo for the account PayPal linked (services spec §4.2, Fact 14); the only input
  // is the member's own "I am 18 or older", used when PayPal sends no age.
  connect: protectedProcedure.input(connectInput).mutation(async ({ ctx, input }) => {
    const userId = ctx.session.user.id;
    const linked = await findLinkedPayPalAccount(ctx.db, userId);
    if (!linked) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Connect PayPal first, then come back to this page.",
      });
    }
    // Server-side call without headers: Better Auth acts for `userId`, decrypting and refreshing the
    // stored token as needed (Fact 14). The account row was found for this same user above.
    const tokens = await ctx.auth.api
      .getAccessToken({ body: { accountId: linked.id, userId } })
      .catch(() => null);
    if (!tokens?.accessToken) throw unconfirmed();
    const userInfo = await fetchPayPalUserInfo(ctx.environment, tokens.accessToken);
    const draft = payoutDestinationFromUserInfo(linked.accountId, userInfo);
    if (!draft || !userInfo) throw unconfirmed();

    const age = payoutAgeFromUserInfo(userInfo);
    if (age.kind === "minor") {
      // A destination saved earlier (before PayPal reported the age) must not stay payable.
      await deletePayoutDestination(ctx.db, userId);
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "PayPal says this account belongs to someone under 18. Payouts need a recipient who is 18 or older.",
      });
    }
    const source: PayoutAgeSource | null = age.kind === "adult" ? "paypal" : input.confirmAdult ? "self" : null;
    const confirmation = source ? { confirmedAt: new Date(), source } : null;
    return toDestinationView(await savePayoutDestination(ctx.db, userId, draft, confirmation));
  }),

  confirmAdult: protectedProcedure.mutation(async ({ ctx }) => {
    const destination = await confirmPayoutDestinationAge(ctx.db, ctx.session.user.id);
    if (!destination) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Connect PayPal first, then confirm your age.",
      });
    }
    return toDestinationView(destination);
  }),
});
