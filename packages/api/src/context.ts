import type { Auth, Session } from "@jendal-workspace/auth";
import type { FileStore, TenantEnvironment } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { Mailer } from "@jendal-workspace/email";
import type { PayPalClient } from "@jendal-workspace/paypal";

import type { CatalogServices } from "./catalog/service";

export type PayPalServices = {
  client: PayPalClient;
  partnerId: string;
  returnUrl: string;
  // What the browser's JS SDK v6 needs. All public values (R1 facts §5).
  sdk: { clientId: string; partnerAttributionId: string; environment: "sandbox" | "live" };
  // Called after team.paypal_merchant_id changes; the api Worker invalidates the KV store cache (Fact 10).
  onTeamMerchantChanged?: (team: { id: string; slug: string }) => void | Promise<void>;
};

// Transactional email outside auth (quote requests). Absent in tests that do not send email.
export type EmailServices = {
  mailer: Mailer;
  // Absolute origins for links in emails, e.g. https://example.com and https://dash.example.com.
  siteOrigin: string;
  dashOrigin: string;
  // The product name people read; set per stage (PLATFORM_NAME).
  platformName: string;
  // Absolute origin of a team's store host, e.g. https://walk-crew.example.com.
  storeOrigin: (slug: string) => string;
  // Sends that may outlive the response; awaited when absent.
  waitUntil?: (promise: Promise<unknown>) => void;
  onError?: (cause: unknown, email: { kind: string; to: string }) => void | Promise<void>;
};

export type PayoutServices = {
  // Seals the teams' PayPal client secrets (AES-GCM, the team id as additional data).
  secretKey: CryptoKey;
  keyId: string;
  // Named in the note PayPal shows the receiver of a payout.
  platformName: string;
  // Builds a PayPal client for one team's own REST app; the server gives it a per-team token cache. That cache
  // must be keyed by the secret too: verifying new credentials must never reuse a token the old ones obtained.
  clientFor(input: { teamId: string; clientId: string; clientSecret: string }): PayPalClient;
};

export type Context = {
  session: Session | null;
  db: Database;
  environment: TenantEnvironment;
  // The product name people read; set per stage (PLATFORM_NAME).
  platformName: string;
  // Procedures that act through Better Auth (organizations, stores) pass the caller's headers on.
  auth: Auth;
  headers: Headers;
  // Absent in tests and when PayPal is not configured; the paypal router then fails with PRECONDITION_FAILED.
  paypal?: PayPalServices;
  // Ports the catalog procedures use; fakes in tests, the real adapters from the server app.
  catalog: CatalogServices;
  // Private files (delivery files); a fake in tests, the R2 adapter from the server app.
  files: FileStore;
  // Called after team.status changes (publishing); the api Worker drops the KV storefront lookups. Absent in tests.
  onTeamStatusChanged?: (team: { id: string; slug: string }) => void | Promise<void>;
  // Absent in tests that do not send email; the request procedure then fails with PRECONDITION_FAILED.
  email?: EmailServices;
  // Absent when no payout credentials key is configured; turning on automatic payouts and sending payouts then fail
  // with PRECONDITION_FAILED.
  payouts?: PayoutServices;
  // The clock payout decisions read (paydays); tests fix it. Absent means the system clock.
  now?: () => Date;
  // Called when an action ran but its action_log row could not be written. Absent in tests.
  onActionLogError?: (cause: unknown) => void;
};
