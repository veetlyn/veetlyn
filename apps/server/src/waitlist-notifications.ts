import type { DbExecutor } from "@jendal-workspace/db/executor";
import { claimWaitlistNotifications, finishWaitlistNotification } from "@jendal-workspace/db/repositories/waitlist";
import { waitlistEntryEmail, type Mailer } from "@jendal-workspace/email";

export async function deliverWaitlistNotifications(input: { db: DbExecutor; mailer: Mailer; now?: Date }) {
  const now = input.now ?? new Date();
  const rows = await claimWaitlistNotifications(input.db, now);
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await input.mailer.send({
        sender: "accounts", tag: "waitlist_signup", to: row.recipient,
        ...waitlistEntryEmail(row),
      }, { idempotencyKey: `waitlist/${row.id}` });
      await finishWaitlistNotification(input.db, row, true, now);
      sent += 1;
    } catch {
      // Keep the sign-up and retry later. Provider errors can contain private addresses.
      await finishWaitlistNotification(input.db, row, false, now);
      failed += 1;
    }
  }
  return { sent, failed };
}
