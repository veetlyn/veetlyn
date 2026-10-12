import { databaseErrorFields } from "@jendal-workspace/api/use-cases/payments";
import type { FileStore } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import { sweepUnattachedUploads } from "@jendal-workspace/db/repositories/files";
import { deleteAbandonedOrders } from "@jendal-workspace/db/repositories/orders";
import { failStuckWebhookEvents, listStaleWebhookEvents } from "@jendal-workspace/db/repositories/paypal-webhooks";
import { deleteExpiredRequestLimits } from "@jendal-workspace/db/repositories/request-limits";
import { log } from "evlog";

import { errorNote } from "./paypal-webhook-queue";

export const STALE_WEBHOOK_MS = 15 * 60_000;
export const STUCK_WEBHOOK_MS = 3 * 24 * 3_600_000;
export const WEBHOOK_BATCH = 100;
export const REQUEST_LIMIT_MAX_AGE_MS = 24 * 3_600_000;
export const UPLOAD_MAX_AGE_MS = 24 * 3_600_000;
export const UPLOAD_BATCH = 500;
// A capture whose reply was lost is settled only by its webhook, which can arrive until the stuck-event cutoff.
export const ORDER_MAX_AGE_MS = STUCK_WEBHOOK_MS + 24 * 3_600_000;
export const ORDER_BATCH = 500;

const STUCK_WEBHOOK_NOTE = "Stuck in received for 3 days.";

export type MaintenanceDeps = {
  db: Database;
  enqueueWebhookEvents: (eventIds: string[]) => Promise<void>;
  files: Pick<FileStore, "delete">;
  now?: () => Date;
};

export type MaintenanceSweep = "webhooks" | "requestLimits" | "uploads" | "orders";

export type MaintenanceReport = {
  webhookEventsRequeued: number;
  webhookEventsFailed: number;
  requestLimitsDeleted: number;
  uploadsDeleted: number;
  ordersDeleted: number;
  errors: MaintenanceSweep[];
};

// Runs every sweep even when an earlier one fails, and never throws: failures are logged and listed in the report.
export async function runMaintenance(deps: MaintenanceDeps): Promise<MaintenanceReport> {
  const now = (deps.now ?? (() => new Date()))().getTime();
  const report: MaintenanceReport = {
    webhookEventsRequeued: 0,
    webhookEventsFailed: 0,
    requestLimitsDeleted: 0,
    uploadsDeleted: 0,
    ordersDeleted: 0,
    errors: [],
  };

  async function sweep(name: MaintenanceSweep, run: () => Promise<Record<string, number>>): Promise<void> {
    const action = `maintenance.${name}`;
    try {
      log.info({ action, maintenance: await run() });
    } catch (error) {
      report.errors.push(name);
      log.error({ action, error: { ...databaseErrorFields(error), note: errorNote(error) } });
    }
  }

  // Stuck events are failed first so they are not re-sent once more in the same run.
  await sweep("webhooks", async () => {
    const failed = await failStuckWebhookEvents(deps.db, {
      receivedBefore: new Date(now - STUCK_WEBHOOK_MS),
      note: STUCK_WEBHOOK_NOTE,
    });
    report.webhookEventsFailed = failed.length;
    if (failed.length > 0) {
      // These events will never be applied, so someone has to look at them.
      log.error({
        action: "maintenance.webhooks.failed",
        paypalWebhook: {
          eventIds: failed.map((event) => event.id),
          eventTypes: [...new Set(failed.map((event) => event.eventType))],
          note: STUCK_WEBHOOK_NOTE,
        },
      });
    }
    const stale = await listStaleWebhookEvents(deps.db, {
      receivedBefore: new Date(now - STALE_WEBHOOK_MS),
      limit: WEBHOOK_BATCH,
    });
    if (stale.length > 0) await deps.enqueueWebhookEvents(stale);
    report.webhookEventsRequeued = stale.length;
    return { requeued: report.webhookEventsRequeued, failed: report.webhookEventsFailed };
  });

  await sweep("requestLimits", async () => {
    report.requestLimitsDeleted = await deleteExpiredRequestLimits(deps.db, {
      windowStartedBefore: now - REQUEST_LIMIT_MAX_AGE_MS,
    });
    return { deleted: report.requestLimitsDeleted };
  });

  await sweep("uploads", async () => {
    report.uploadsDeleted = await sweepUnattachedUploads(
      deps.db,
      { createdBefore: new Date(now - UPLOAD_MAX_AGE_MS), limit: UPLOAD_BATCH },
      (keys) => deps.files.delete(keys),
    );
    return { deleted: report.uploadsDeleted };
  });

  await sweep("orders", async () => {
    report.ordersDeleted = await deleteAbandonedOrders(deps.db, {
      createdBefore: new Date(now - ORDER_MAX_AGE_MS),
      limit: ORDER_BATCH,
    });
    return { deleted: report.ordersDeleted };
  });

  return report;
}
