import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { storeSlugProblem, validateStoreSlug } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import { isStoreSlugTaken } from "@jendal-workspace/db/repositories/stores";
import * as schema from "@jendal-workspace/db/schema/index";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { organization } from "better-auth/plugins/organization";

import { paypalAuthorizationEndpoint, paypalEmail } from "./paypal";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  PAYPAL_CLIENT_ID: string;
  PAYPAL_CLIENT_SECRET: string;
  PAYPAL_ENVIRONMENT: string;
};

// A store is a team (spec §4.1). status and paypalMerchantId are set by our own code only.
const storeFields = {
  slug: { type: "string", required: true, unique: true, input: true },
  status: { type: "string", required: true, defaultValue: "draft", input: false },
  paypalMerchantId: { type: "string", required: false, unique: true, input: false },
} as const;

async function claimStoreSlug(database: Database, input: unknown): Promise<string> {
  const result = validateStoreSlug(typeof input === "string" ? input : "");
  if (!result.ok) {
    throw new APIError("BAD_REQUEST", {
      code: result.reason === "reserved" ? "STORE_SLUG_RESERVED" : "STORE_SLUG_INVALID",
      message: storeSlugProblem(result.reason),
    });
  }
  // The unique index on team.slug still guards against a concurrent claim.
  if (await isStoreSlugTaken(database, result.slug)) {
    throw new APIError("CONFLICT", { code: "STORE_SLUG_TAKEN", message: storeSlugProblem("taken") });
  }
  return result.slug;
}

export function createAuth(env: AuthConfig, database: Database) {
  const paypalLive = env.PAYPAL_ENVIRONMENT === "live";
  return betterAuth({
    database: drizzleAdapter(database, { provider: "pg", schema }),
    emailAndPassword: { enabled: true },
    socialProviders: {
      paypal: {
        clientId: env.PAYPAL_CLIENT_ID,
        clientSecret: env.PAYPAL_CLIENT_SECRET,
        environment: paypalLive ? "live" : "sandbox",
        authorizationEndpoint: paypalAuthorizationEndpoint(paypalLive),
        mapProfileToUser: (profile) => paypalEmail(profile),
      },
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    plugins: [
      organization({
        // A store needs a slug, so no team is created automatically with an organization.
        teams: { enabled: true, defaultTeam: { enabled: false } },
        schema: { team: { additionalFields: storeFields } },
        organizationHooks: {
          beforeCreateTeam: async ({ team }) => ({
            data: { slug: await claimStoreSlug(database, team.slug), status: "draft", paypalMerchantId: null },
          }),
          // Store URLs and the KV cache are keyed by slug, so slugs cannot change until W1-C adds invalidation.
          beforeUpdateTeam: async ({ team, updates }) => {
            if (updates.slug !== undefined && updates.slug !== team.slug) {
              throw new APIError("BAD_REQUEST", {
                code: "STORE_SLUG_IMMUTABLE",
                message: "A store address cannot be changed.",
              });
            }
          },
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
