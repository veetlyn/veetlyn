import { boolean, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { team } from "./organization";

export type PayPalOnboardingStatus = "pending" | "connected" | "needs_attention";

// The normalized oauth_integrations payload from PayPal's merchant-integration status.
// Declared here because packages/db must not import packages/paypal (platform spec §3.2).
export type StoredOAuthIntegration = {
  integrationType?: string;
  integrationMethod?: string;
  status?: string;
  oauthThirdParty: { partnerClientId?: string; merchantClientId?: string; scopes: string[] }[];
};

// One PayPal onboarding per team (store or services team). tracking_id is the team ID;
// PayPal sends it back as `merchantId` on the return URL (Fact 6).
export const paypalOnboarding = pgTable("paypal_onboarding", {
  teamId: text("team_id")
    .primaryKey()
    .references(() => team.id, { onDelete: "cascade" }),
  trackingId: text("tracking_id").notNull().unique(),
  actionUrl: text("action_url"),
  status: text("status").$type<PayPalOnboardingStatus>().default("pending").notNull(),
  merchantId: text("merchant_id"),
  paymentsReceivable: boolean("payments_receivable"),
  primaryEmailConfirmed: boolean("primary_email_confirmed"),
  oauthIntegrations: jsonb("oauth_integrations").$type<StoredOAuthIntegration[]>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
