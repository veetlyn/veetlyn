import { createAuth as createConfiguredAuth } from "@jendal-workspace/auth";
import { type Database, createDb } from "@jendal-workspace/db";
import { createSmtpMailer } from "@jendal-workspace/email";
import type { ExecutionContext } from "hono";

import { logEmailError } from "./email-log";
import { ENV } from "./env.server";

export function getDb(): Database {
  return createDb({ DATABASE_URL: ENV.HYPERDRIVE.connectionString });
}

export function createAuth(database: Database, executionCtx: ExecutionContext) {
  return createConfiguredAuth(ENV, database, {
    mailer: createSmtpMailer(ENV),
    waitUntil: (promise) => executionCtx.waitUntil(promise),
    onEmailError: logEmailError,
  });
}
