import type { Database } from "@jendal-workspace/db";
import { user } from "@jendal-workspace/db/schema/auth";
import { createFakeMailer, type Mailer } from "@jendal-workspace/email";
import { eq } from "drizzle-orm";

import { type Auth, type AuthConfig, type AuthEmailKind, createAuth } from "./index";

export const TEST_AUTH_CONFIG: AuthConfig = {
  BETTER_AUTH_URL: "http://dash.localhost:3001",
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
  PAYPAL_CLIENT_ID: "sandbox-client-id",
  PAYPAL_CLIENT_SECRET: "sandbox-client-secret",
  PAYPAL_ENVIRONMENT: "sandbox",
  DISCORD_CLIENT_ID: "discord-client-id",
  DISCORD_CLIENT_SECRET: "discord-client-secret",
};

export const TEST_PASSWORD = "correct-horse-battery";

export function createTestAuth(db: Database, options: { config?: Partial<AuthConfig>; mailer?: Mailer } = {}) {
  const mailer = createFakeMailer();
  const pending: Promise<unknown>[] = [];
  const emailErrors: Array<{ kind: AuthEmailKind; to: string }> = [];
  const auth = createAuth({ ...TEST_AUTH_CONFIG, ...options.config }, db, {
    mailer: options.mailer ?? mailer,
    waitUntil: (promise) => {
      pending.push(promise);
    },
    onEmailError: (_error, email) => {
      emailErrors.push(email);
    },
  });
  return { auth, mailer, emailErrors, settle: () => Promise.all(pending) };
}

export function cookieHeaders(source: Headers): Headers {
  const cookie = source
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return new Headers({ cookie });
}

// Email sign-in needs a verified address, so tests that only need a session skip the email round trip.
export async function signUpVerified(auth: Auth, db: Database, email: string, name = "Ada") {
  const { user: created } = await auth.api.signUpEmail({ body: { name, email, password: TEST_PASSWORD } });
  await db.update(user).set({ emailVerified: true }).where(eq(user.id, created.id));
  const { headers } = await auth.api.signInEmail({ body: { email, password: TEST_PASSWORD }, returnHeaders: true });
  return { userId: created.id, email, headers: cookieHeaders(headers) };
}
