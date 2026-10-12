import { payoutDestinationFromUserInfo } from "@jendal-workspace/core";
import {
  findLinkedPayPalAccount,
  getPayoutDestination,
  savePayoutDestination,
} from "@jendal-workspace/db/repositories/payouts";
import { TRPCError } from "@trpc/server";

import { protectedProcedure, router } from "../index";
import { fetchPayPalUserInfo } from "../paypal-userinfo";

// tRPC has no transformer here, so dates are returned as ISO strings (as servicesTeam.get does).
function toDestinationView(record: { paypalPayerId: string; paypalEmail: string | null; verifiedAt: Date }) {
  return {
    paypalPayerId: record.paypalPayerId,
    paypalEmail: record.paypalEmail,
    verifiedAt: record.verifiedAt.toISOString(),
  };
}

function unconfirmed(): TRPCError {
  return new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "PayPal did not confirm your payer ID. Connect PayPal again.",
  });
}

export const payoutDestinationRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const destination = await getPayoutDestination(ctx.db, ctx.session.user.id);
    return destination ? toDestinationView(destination) : null;
  }),

  // Runs after "Log in with PayPal" returns the user to /me/payouts. Takes no input: the payer ID and
  // email come only from PayPal's userinfo for the account PayPal linked (services spec §4.2, Fact 14).
  connect: protectedProcedure.mutation(async ({ ctx }) => {
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
    if (!draft) throw unconfirmed();
    return toDestinationView(await savePayoutDestination(ctx.db, userId, draft, null));
  }),
});
