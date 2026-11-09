import type { Database } from "@jendal-workspace/db";

import { ENV } from "../env.server";
import {
  createAuth,
  createFileStore,
  getEmailServices,
  getPayoutServices,
  getPayPalServices,
  logActionLogError,
} from "../services";

const files = createFileStore();

type Background = { waitUntil(promise: Promise<unknown>): void };

// What a turn needs to act as a person, for turns that run outside a request's own context.
export async function agentActionDeps(db: Database, background: Background) {
  return {
    db,
    platformName: ENV.PLATFORM_NAME,
    files,
    auth: createAuth(db, { waitUntil: (promise: Promise<unknown>) => background.waitUntil(promise), passThroughOnException: () => undefined, props: {} }),
    paypal: getPayPalServices(),
    payouts: await getPayoutServices(),
    email: getEmailServices(background),
    onLogError: logActionLogError,
  };
}
