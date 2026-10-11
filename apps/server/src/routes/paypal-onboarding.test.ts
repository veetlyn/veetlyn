import type { PayPalServices } from "@jendal-workspace/api/context";
import type { Auth } from "@jendal-workspace/auth";
import type { Database } from "@jendal-workspace/db";
import { createPayPalClient } from "@jendal-workspace/paypal";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse } from "@jendal-workspace/paypal/testing";
import { fromAny, fromPartial } from "@total-typescript/shoehorn";
import { evlog } from "evlog/hono";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AppEnv } from "../app-env";
import { createPayPalOnboardingRoute } from "./paypal-onboarding";

const teamRow = {
  id: "team-1",
  organizationId: "org-1",
  slug: "acme",
  name: "Acme",
  status: "active",
  paypalMerchantId: null,
};
const session = { user: { id: "user-1" }, session: { id: "session-1" } };
// findTeamAccess selects the team columns plus product, role and teamMemberId (null = not a team member).
const ownerAccess = { ...teamRow, product: "store", role: "owner", teamMemberId: null };

// Minimal drizzle query-builder stand-ins: select().from().innerJoin().leftJoin().where().limit()
// for findTeamAccess, insert().values().onConflictDoUpdate().returning() for the integration
// upsert, update().set().where().returning() for markTeamPayPalMerchant.
function fakeDb(rows: unknown[]) {
  return {
    select: () => ({
      from: () => ({ innerJoin: () => ({ leftJoin: () => ({ where: () => ({ limit: async () => rows }) }) }) }),
    }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: () => ({ returning: async () => [{}] }) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ slug: "acme" }] }) }) }),
  };
}

// A fake PayPal API whose tracking lookup and status GET both report a connected seller.
function makePayPal(onTeamMerchantChanged?: PayPalServices["onTeamMerchantChanged"]): PayPalServices {
  const { fetch } = fakeFetch((request) => {
    if (request.url.endsWith("/v1/oauth2/token")) return jsonResponse(200, FAKE_TOKEN_RESPONSE);
    if (request.url.includes("/merchant-integrations?tracking_id=")) {
      return jsonResponse(200, { merchant_id: "SELLER1", tracking_id: "team-1" });
    }
    if (request.url.includes("/merchant-integrations/")) {
      return jsonResponse(200, {
        merchant_id: "SELLER1",
        tracking_id: "team-1",
        payments_receivable: true,
        primary_email_confirmed: true,
        oauth_integrations: [],
      });
    }
    return jsonResponse(500, { name: "UNEXPECTED_CALL", debug_id: "d500" });
  });
  return {
    client: createPayPalClient({
      clientId: "partner-client-id",
      clientSecret: "partner-secret",
      environment: "sandbox",
      fetch,
      sleep: () => Promise.resolve(),
    }),
    partnerId: "PARTNER42",
    returnUrl: "http://admin.localhost:3001/api/paypal/onboarding/return",
    sdk: { clientId: "partner-client-id", partnerAttributionId: "PAYLEOR_BN", environment: "sandbox" },
    onTeamMerchantChanged,
  };
}

function buildApp(options: { session?: unknown; rows?: unknown[]; paypal?: PayPalServices | null } = {}) {
  // getSession is generic over its options; the route only awaits the session it resolves to.
  const auth = fromPartial<Auth>({ api: { getSession: fromAny(async () => options.session ?? null) } });
  const app = new Hono<AppEnv>();
  app.use(evlog());
  app.use("*", async (c, next) => {
    c.set("db", fromPartial<Database>(fakeDb(options.rows ?? [ownerAccess])));
    c.set("auth", auth);
    await next();
  });
  const paypal = options.paypal === null ? undefined : (options.paypal ?? makePayPal());
  app.route("/api/paypal/onboarding/return", createPayPalOnboardingRoute(paypal));
  return app;
}

const RETURN = "/api/paypal/onboarding/return?merchantId=team-1&merchantIdInPayPal=SELLER1";

describe("paypal onboarding return route", () => {
  it("redirects to the login page when the request has no session", async () => {
    const res = await buildApp().request(`http://localhost${RETURN}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("redirects to the store list when PayPal sends no tracking id", async () => {
    const res = await buildApp({ session }).request(
      "http://localhost/api/paypal/onboarding/return?merchantIdInPayPal=SELLER1",
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });

  it("answers 404 for a team the caller cannot administer", async () => {
    expect((await buildApp({ session, rows: [] }).request(`http://localhost${RETURN}`)).status).toBe(404);
    const memberRows = [{ ...teamRow, role: "member", teamMemberId: "tm-1" }];
    expect((await buildApp({ session, rows: memberRows }).request(`http://localhost${RETURN}`)).status).toBe(404);
  });

  it("answers 503 when PayPal is not configured", async () => {
    const res = await buildApp({ session, paypal: null }).request(`http://localhost${RETURN}`);
    expect(res.status).toBe(503);
  });

  it("confirms the integration and redirects to the team's dashboard", async () => {
    const onTeamMerchantChanged = vi.fn();
    const app = buildApp({ session, paypal: makePayPal(onTeamMerchantChanged) });

    const res = await app.request(`http://localhost${RETURN}`);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/acme");
    expect(onTeamMerchantChanged).toHaveBeenCalledWith({ id: "team-1", slug: "acme" });
  });
});
