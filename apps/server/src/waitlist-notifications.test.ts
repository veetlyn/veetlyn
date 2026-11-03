import { createTestDb, hasTestDatabase, truncateAll } from "@jendal-workspace/db/testing/db";
import { joinWaitlist } from "@jendal-workspace/db/repositories/waitlist";
import { waitlistNotification } from "@jendal-workspace/db/schema/waitlist";
import { createFakeMailer, type EmailMessage, type Mailer } from "@jendal-workspace/email";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { deliverWaitlistNotifications } from "./waitlist-notifications";

describe.skipIf(!hasTestDatabase)("waitlist notification delivery", () => {
  const db = createTestDb();
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());
  const alert = { recipient: "owner@example.com", platformName: "Platform" };

  it("notifies only the configured owner, once, across simultaneous sweepers", async () => {
    await joinWaitlist(db, "new@example.com", alert);
    const mailer = createFakeMailer();
    await Promise.all([deliverWaitlistNotifications({ db, mailer }), deliverWaitlistNotifications({ db, mailer })]);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: alert.recipient, sender: "accounts", tag: "waitlist_signup" });
    expect(mailer.sent[0]?.text).toContain("new@example.com");
    expect((await db.select().from(waitlistNotification))[0]?.sentAt).toBeInstanceOf(Date);
    await deliverWaitlistNotifications({ db, mailer });
    expect(mailer.sent).toHaveLength(1);
  });

  it("retains failed notifications and retries the same message with the same idempotency key", async () => {
    await joinWaitlist(db, "retry@example.com", alert);
    const messages: EmailMessage[] = [];
    const keys: (string | undefined)[] = [];
    const mailer: Mailer = { async send(message, options) {
      messages.push(message); keys.push(options?.idempotencyKey);
      if (messages.length === 1) throw new Error("temporary transport outage");
    } };
    const now = new Date();
    expect(await deliverWaitlistNotifications({ db, mailer, now })).toEqual({ sent: 0, failed: 1 });
    expect(await deliverWaitlistNotifications({ db, mailer, now })).toEqual({ sent: 0, failed: 0 });
    const [pending] = await db.select().from(waitlistNotification);
    expect(pending).toMatchObject({ sentAt: null, attempts: 1 });
    expect(await deliverWaitlistNotifications({ db, mailer, now: new Date(now.getTime() + 3 * 60_000) })).toEqual({ sent: 1, failed: 0 });
    expect(messages[1]).toEqual(messages[0]);
    expect(keys[0]).toMatch(/^waitlist\//);
    expect(keys[1]).toEqual(keys[0]);
  });

  it("leaves sign-ups without an alert destination out of the queue", async () => {
    await joinWaitlist(db, "quiet@example.com");
    expect(await db.select().from(waitlistNotification)).toEqual([]);
  });
});
