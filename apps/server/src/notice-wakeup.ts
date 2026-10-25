import type { ExecutionContext, MiddlewareHandler } from "hono";

export function wakeNoticesAfterMutation(wake: (execution: ExecutionContext) => Promise<void>): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const mutation = ["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method);
    const actionPath = c.req.path.startsWith("/trpc/") || c.req.path === "/mcp" || c.req.path === "/discord/interactions" || c.req.path === "/webhooks/paypal";
    if (mutation && actionPath && c.res.status >= 200 && c.res.status < 400) {
      const execution = c.executionCtx;
      execution.waitUntil(Promise.resolve().then(() => wake(execution)));
    }
  };
}
