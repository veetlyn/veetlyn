import { errorName } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import { applySubscriptionSnapshot, billingAccountsToReconcile } from "@jendal-workspace/db/repositories/billing";
import { log } from "evlog";

import { type PolarClient, polarSubscription, subscriptionSnapshot } from "./polar";

// Refresh missed webhook updates without letting a failure on one customer block everybody else.
export async function reconcileBilling(db: Database, polar: PolarClient, now: Date) {
  const report = { checked: 0, applied: 0, failed: 0 };
  const before = new Date(now.getTime() - 86_400_000);
  let afterOrganizationId = "";
  for (;;) {
    const accounts = await billingAccountsToReconcile(db, { before, afterOrganizationId, limit: 100 });
    for (const account of accounts) {
      afterOrganizationId = account.organizationId;
      if (!account.polarSubscriptionId) continue;
      report.checked++;
      try {
        const remote = await polar.subscriptions.get(account.polarSubscriptionId);
        const snapshot = subscriptionSnapshot(polarSubscription.parse(remote));
        if (!snapshot || snapshot.organizationId !== account.organizationId || snapshot.subscriptionId !== account.polarSubscriptionId) {
          throw new Error("Polar subscription does not match the billing account");
        }
        if (await applySubscriptionSnapshot(db, snapshot)) report.applied++;
      } catch (error) {
        report.failed++;
        log.error({ action: "billing.reconcile", organizationId: account.organizationId, error: { name: errorName(error) } });
      }
    }
    if (accounts.length < 100) return report;
  }
}
