import type { PayPalServices } from "@jendal-workspace/api/context";
import { refreshPayPalOnboarding } from "@jendal-workspace/api/paypal/onboarding";
import { hasStoreWideRole } from "@jendal-workspace/core";
import { findTeamAccess } from "@jendal-workspace/db/repositories/teams";
import { PayPalError } from "@jendal-workspace/paypal";
import { Hono } from "hono";

import type { AppEnv } from "../app-env";

// PayPal returns the seller's browser here (partner_config_override.return_url). The query
// parameters (merchantId = our tracking id = team id, merchantIdInPayPal = the seller account
// id, Fact 6) are hints only: refreshPayPalOnboarding always re-reads the integration from
// PayPal before anything is stored. Redirects stay path-relative: this route is reached on
// the admin host, where "/{slug}" is the team's dashboard and "/" lists the teams.
export function createPayPalOnboardingRoute(paypal: PayPalServices | undefined): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const session = await c.get("auth").api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.redirect("/login");

    const teamId = c.req.query("merchantId");
    if (!teamId) return c.redirect("/");

    const access = await findTeamAccess(c.get("db"), { teamId, userId: session.user.id });
    if (!access || !hasStoreWideRole(access.role)) return c.json({ error: "team_not_found" }, 404);
    if (!paypal) return c.json({ error: "paypal_not_configured" }, 503);

    try {
      const view = await refreshPayPalOnboarding({ db: c.get("db"), ...paypal }, access.team, {
        merchantIdInPayPal: c.req.query("merchantIdInPayPal") ?? undefined,
      });
      c.get("log").set({ paypal: { teamId, state: view.state } });
      return c.redirect(`/${access.team.slug}`);
    } catch (error) {
      if (error instanceof PayPalError) {
        c.get("log").error("PayPal onboarding return failed", {
          err: error,
          paypal: { debugId: error.debugId, status: error.status, teamId },
        });
        return c.json({ error: "paypal_confirmation_failed" }, 502);
      }
      throw error;
    }
  });

  return app;
}
