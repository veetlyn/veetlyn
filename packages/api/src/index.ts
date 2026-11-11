import { initTRPC, TRPCError } from "@trpc/server";

import type { Context } from "./context";

// Error responses never carry stack traces; server logs keep them (apps/server trpc-error-log).
export const t = initTRPC.context<Context>().create({
  isDev: false,
  // An error nobody wrote for a person (a failed query, a thrown Error) is wrapped by tRPC with its own message, which
  // can carry SQL and the values bound to it. Only errors the code raised on purpose keep their words.
  errorFormatter(formatted) {
    const { error } = formatted;
    const response = formatted["shape"];
    const wrapped = error.code === "INTERNAL_SERVER_ERROR" && error.cause !== undefined && !(error.cause instanceof TRPCError) && error.message === error.cause.message;
    return wrapped ? { ...response, message: "Something went wrong on our side. Try again in a moment." } : response;
  },
});

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
