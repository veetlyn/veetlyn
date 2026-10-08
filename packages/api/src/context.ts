import type { Auth, Session } from "@jendal-workspace/auth";
import type { FileStore, TenantEnvironment } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
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

export type Context = {
  session: Session | null;
  db: Database;
  environment: TenantEnvironment;
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
};
