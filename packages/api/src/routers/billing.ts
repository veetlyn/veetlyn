import { BILLING_PRODUCTS, entitlementsFor, hasStoreWideRole, parsePolarProductKey, polarProductKey, type PlanChoice } from "@jendal-workspace/core";
import { applySubscriptionSnapshot, billingSnapshot, getBillingAccount, lockBillingAccount } from "@jendal-workspace/db/repositories/billing";
import { hitRequestLimit } from "@jendal-workspace/db/repositories/request-limits";
import { workspaceRoleFor } from "@jendal-workspace/db/repositories/services-teams";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { type PolarClient, polarSubscription, productKeyOf, subscriptionSnapshot } from "../billing/polar";
import { protectedProcedure, router } from "../index";

const workspaceInput = z.object({ organizationId: z.string().min(1).max(128) });
const choiceInput = workspaceInput.extend({
  servicesTier: z.enum(["solo", "team", "agency"]).nullable(),
  storeTier: z.enum(["starter", "grow", "scale"]).nullable(),
  interval: z.enum(["monthly", "yearly"]),
}).refine((choice) => choice.servicesTier !== null || choice.storeTier !== null, "Choose at least one plan.");

const workspaceProcedure = protectedProcedure.input(workspaceInput).use(async ({ ctx, input, next }) => {
  const role = await workspaceRoleFor(ctx.db, input.organizationId, ctx.session.user.id);
  if (!role || !hasStoreWideRole(role)) throw new TRPCError({ code: "FORBIDDEN", message: "Only workspace owners and admins can manage billing." });
  const account = await getBillingAccount(ctx.db, input.organizationId);
  if (!account) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Create your first team before choosing a plan." });
  return next({ ctx: { ...ctx, billingAccount: account } });
});

const providerProcedure = workspaceProcedure.use(async ({ ctx, input, next }) => {
  if (!ctx.billing) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Billing is not configured on this server." });
  if (!(await hitRequestLimit(ctx.db, { key: `billing:${input.organizationId}`, windowMs: 60_000, max: 20 }))) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many billing requests. Try again in a minute." });
  }
  return next({ ctx: { ...ctx, billing: ctx.billing } });
});

function billingUrl(origin: string, organizationId: string) {
  return new URL(`/w/${encodeURIComponent(organizationId)}/billing`, origin).href;
}

async function catalog(polar: PolarClient) {
  const products = [];
  for await (const product of polar.products.iterList({ is_archived: false, is_recurring: true, limit: 100 })) {
    const key = productKeyOf(product.metadata);
    const wanted = BILLING_PRODUCTS.find((p) => p.key === key);
    if (!wanted) continue;
    const prices = product.prices.filter((p) => !p.is_archived);
    const price = prices.length === 1 ? prices[0] : undefined;
    if (!price || price.amount_type !== "fixed" || price.price_currency !== "usd" || price.price_amount !== wanted.chargeCents
      || product.recurring_interval !== (wanted.interval === "yearly" ? "year" : "month")) continue;
    products.push({ id: product.id, key: wanted.key });
  }
  return products;
}

const SERVICES_RANK = { solo: 1, team: 2, agency: 3 } as const;
const STORE_RANK = { starter: 1, grow: 2, scale: 3 } as const;

// Billing design §5: a change that lowers either plan, or moves from yearly to monthly, waits for the renewal so
// limits never drop mid-period; anything else applies now, prorated. A mixed change counts as a downgrade.
export function isDowngrade(current: PlanChoice, next: PlanChoice): boolean {
  const services = (c: PlanChoice) => (c.servicesTier ? SERVICES_RANK[c.servicesTier] : 0);
  const store = (c: PlanChoice) => (c.storeTier ? STORE_RANK[c.storeTier] : 0);
  return services(next) < services(current) || store(next) < store(current) || (current.interval === "yearly" && next.interval === "monthly");
}

export const billingRouter = router({
  get: workspaceProcedure.query(({ ctx }) => ({
    choice: { servicesTier: ctx.billingAccount.servicesTier, storeTier: ctx.billingAccount.storeTier, interval: ctx.billingAccount.interval },
    entitlements: entitlementsFor(billingSnapshot(ctx.billingAccount), (ctx.now ?? (() => new Date()))()),
    trialEndsAt: ctx.billingAccount.trialEndsAt,
    currentPeriodEnd: ctx.billingAccount.currentPeriodEnd,
    cancelAtPeriodEnd: ctx.billingAccount.cancelAtPeriodEnd,
    subscribed: ctx.billingAccount.polarSubscriptionId !== null,
    configured: Boolean(ctx.billing),
  })),

  startCheckout: providerProcedure.input(choiceInput).mutation(async ({ ctx, input }) => {
    const { polar, dashOrigin } = ctx.billing;
    return ctx.db.transaction(async (tx) => {
      const account = await lockBillingAccount(tx, input.organizationId);
      if (!account) throw new TRPCError({ code: "NOT_FOUND" });
      // Read Polar as well: checkout may have succeeded before its webhook arrived.
      for await (const sub of polar.subscriptions.iterList({ external_customer_id: input.organizationId, limit: 100 })) {
        if (!["canceled", "unpaid", "incomplete_expired"].includes(sub.status) || (sub.ends_at && new Date(sub.ends_at) > new Date())) {
          throw new TRPCError({ code: "CONFLICT", message: "This workspace already has a subscription. Use Change plan or Manage billing." });
        }
      }
      const products = await catalog(polar);
      const selected = products.filter((p) => p.key === polarProductKey(input));
      if (selected.length !== 1) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This plan is unavailable. Please try again later." });
      const product = selected[0]!;
      // Reuse open checkouts under the workspace lock, including one whose create response was lost.
      for await (const checkout of polar.checkouts.iterList({ external_customer_id: input.organizationId, status: ["open", "confirmed"], limit: 100 })) {
        if (checkout.status === "confirmed") throw new TRPCError({ code: "CONFLICT", message: "Your payment is still processing." });
        if (new Date(checkout.expires_at) <= new Date()) continue;
        const updated = await polar.checkouts.update(checkout.id, { product_id: product.id });
        return { url: updated.url };
      }
      const returnUrl = billingUrl(dashOrigin, input.organizationId);
      const checkout = await polar.checkouts.create({
        // Only the chosen plan: the plan picker is ours, not Polar's.
        products: [product.id],
        external_customer_id: input.organizationId,
        metadata: { organization_id: input.organizationId },
        customer_email: ctx.session.user.email,
        allow_trial: false,
        success_url: `${returnUrl}?checkout={CHECKOUT_ID}`,
        return_url: returnUrl,
      });
      return { url: checkout.url };
    });
  }),

  changePlan: providerProcedure.input(choiceInput).mutation(async ({ ctx, input }) => {
    const { polar } = ctx.billing;
    return ctx.db.transaction(async (tx) => {
      const account = await lockBillingAccount(tx, input.organizationId);
      if (!account?.polarSubscriptionId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Subscribe before changing plans." });
      const remote = await polar.subscriptions.get(account.polarSubscriptionId);
      const current = subscriptionSnapshot(polarSubscription.parse(remote));
      if (!current || current.organizationId !== input.organizationId) throw new TRPCError({ code: "CONFLICT", message: "The subscription does not match this workspace." });
      if (polarProductKey(current) === polarProductKey(input)) throw new TRPCError({ code: "BAD_REQUEST", message: "This workspace is already on that plan." });
      const matches = (await catalog(polar)).filter((p) => p.key === polarProductKey(input));
      if (matches.length !== 1) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This plan is unavailable. Please try again later." });
      const timing = isDowngrade(current, input) ? "next_period" : "prorate";
      const updated = await polar.subscriptions.update(remote.id, { product_id: matches[0]!.id, proration_behavior: timing });
      return { timing, appliesAt: updated.pending_update?.applies_at ?? null };
    });
  }),

  portalUrl: providerProcedure.mutation(async ({ ctx, input }) => {
    if (!ctx.billingAccount.polarCustomerId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Subscribe before managing billing." });
    const session = await ctx.billing.polar.customerSessions.create({
      external_customer_id: input.organizationId,
      return_url: billingUrl(ctx.billing.dashOrigin, input.organizationId),
    });
    return { url: session.customer_portal_url };
  }),

  pendingChange: providerProcedure.query(async ({ ctx, input }) => {
    if (!ctx.billingAccount.polarSubscriptionId) return null;
    const sub = await ctx.billing.polar.subscriptions.get(ctx.billingAccount.polarSubscriptionId);
    const parsed = subscriptionSnapshot(polarSubscription.parse(sub));
    if (!parsed || parsed.organizationId !== input.organizationId) throw new TRPCError({ code: "CONFLICT" });
    if (!sub.pending_update?.product_id) return null;
    const product = await ctx.billing.polar.products.get(sub.pending_update.product_id);
    const key = productKeyOf(product.metadata);
    return { choice: key ? parsePolarProductKey(key) : null, appliesAt: sub.pending_update.applies_at };
  }),

  syncCheckout: providerProcedure.input(z.object({ checkoutId: z.string().min(1).max(128) })).mutation(async ({ ctx, input }) => {
    const checkout = await ctx.billing.polar.checkouts.get(input.checkoutId);
    if (checkout.external_customer_id !== input.organizationId) throw new TRPCError({ code: "NOT_FOUND", message: "Checkout not found." });
    if (checkout.status !== "succeeded" || !checkout.subscription_id) return { applied: false };
    const sub = await ctx.billing.polar.subscriptions.get(checkout.subscription_id);
    const snapshot = subscriptionSnapshot(polarSubscription.parse(sub));
    if (!snapshot || snapshot.organizationId !== input.organizationId) throw new TRPCError({ code: "CONFLICT" });
    return { applied: await applySubscriptionSnapshot(ctx.db, snapshot) };
  }),
});
