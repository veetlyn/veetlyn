import { initTRPC, TRPCError } from "@trpc/server";

import type { Context } from "./context";

// Error responses never carry stack traces; server logs keep them (apps/server trpc-error-log).
export const t = initTRPC.context<Context>().create({ isDev: false });

export const router = t.router;

export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
      cause: "No session",
    });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});
