import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { storeSlugProblem, validateStoreSlug } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import { isStoreSlugTaken } from "@jendal-workspace/db/repositories/stores";
import * as schema from "@jendal-workspace/db/schema/index";
import { type EmailMessage, type Mailer, passwordResetEmail, verificationEmail } from "@jendal-workspace/email";
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

export type AuthEmailKind = "verification" | "password-reset";

export type AuthServices = {
  mailer: Mailer;
  // The Worker's ctx.waitUntil: emails and Better Auth background tasks finish after the response.
  waitUntil: (promise: Promise<unknown>) => void;
  // This package does not log; the api Worker logs with the recipient hashed.
  onEmailError: (error: unknown, email: { kind: AuthEmailKind; to: string }) => void | Promise<void>;
};

const ONE_HOUR_IN_SECONDS = 60 * 60;

// A store is a team (spec §4.1). Fields with input: false are set by our own code only.
const storeFields = {
  slug: { type: "string", required: true, unique: true, input: true },
  status: { type: "string", required: true, defaultValue: "draft", input: false },
  paypalMerchantId: { type: "string", required: false, unique: true, input: false },
  supportEmail: { type: "string", required: false, input: false },
} as const;

const userFields = {
  acceptedTermsAt: { type: "date", required: false, input: false },
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

// Not awaited, so response times do not reveal whether an account exists (spec §5.1).
function sendInBackground(services: AuthServices, kind: AuthEmailKind, message: EmailMessage): void {
  services.waitUntil(
    services.mailer.send(message).catch((error: unknown) => services.onEmailError(error, { kind, to: message.to })),
  );
}

export function createAuth(env: AuthConfig, database: Database, services: AuthServices) {
  const paypalLive = env.PAYPAL_ENVIRONMENT === "live";
  return betterAuth({
    database: drizzleAdapter(database, { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      resetPasswordTokenExpiresIn: ONE_HOUR_IN_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        sendInBackground(services, "password-reset", { to: user.email, ...passwordResetEmail({ name: user.name, url }) });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: ONE_HOUR_IN_SECONDS,
      sendVerificationEmail: async ({ user, url }) => {
        sendInBackground(services, "verification", { to: user.email, ...verificationEmail({ name: user.name, url }) });
      },
    },
    user: { additionalFields: userFields },
    databaseHooks: {
      user: {
        create: {
          // Every sign-up form and the PayPal button state that continuing accepts the terms.
          before: async (user) => ({ data: { ...user, acceptedTermsAt: new Date() } }),
        },
      },
    },
    rateLimit: {
      // Better Auth enables it only in production by default; the limits are part of the product.
      enabled: true,
      // Worker isolates share no memory.
      storage: "database",
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 600, max: 3 },
        "/send-verification-email": { window: 600, max: 3 },
      },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      backgroundTasks: { handler: services.waitUntil },
    },
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
          beforeCreateTeam: async ({ team, user }) => ({
            data: {
              slug: await claimStoreSlug(database, team.slug),
              status: "draft",
              paypalMerchantId: null,
              supportEmail: user?.email ?? null,
            },
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
