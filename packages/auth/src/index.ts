import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { isTeamProduct, type TeamProduct, teamSlugProblem, validateStoreSlug } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import { createServicesTeamSettings } from "@jendal-workspace/db/repositories/services-teams";
import { isStoreSlugTaken } from "@jendal-workspace/db/repositories/stores";
import * as schema from "@jendal-workspace/db/schema/index";
import {
  type EmailContent,
  type EmailMessage,
  type Mailer,
  passwordResetEmail,
  verificationEmail,
} from "@jendal-workspace/email";
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
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
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

// A store or a services team is a Better Auth team (services spec §3). Fields with input: false are set by our own
// code only; product must be settable at creation, so it is input: true, and the hooks keep it valid.
const teamFields = {
  slug: { type: "string", required: true, unique: true, input: true },
  product: { type: "string", required: false, defaultValue: "store", input: true },
  status: { type: "string", required: true, defaultValue: "draft", input: false },
  paypalMerchantId: { type: "string", required: false, unique: true, input: false },
  supportEmail: { type: "string", required: false, input: false },
} as const;

const userFields = {
  acceptedTermsAt: { type: "date", required: false, input: false },
} as const;

async function claimTeamSlug(database: Database, input: unknown, product: TeamProduct): Promise<string> {
  const result = validateStoreSlug(typeof input === "string" ? input : "");
  if (!result.ok) {
    throw new APIError("BAD_REQUEST", {
      code: result.reason === "reserved" ? "TEAM_SLUG_RESERVED" : "TEAM_SLUG_INVALID",
      message: teamSlugProblem(result.reason, product),
    });
  }
  // The unique index on team.slug still guards against a concurrent claim; stores and services teams share it.
  if (await isStoreSlugTaken(database, result.slug)) {
    throw new APIError("CONFLICT", { code: "TEAM_SLUG_TAKEN", message: teamSlugProblem("taken", product) });
  }
  return result.slug;
}

// Not awaited, so response times do not reveal whether an account exists (spec §5.1).
function sendInBackground(services: AuthServices, kind: AuthEmailKind, content: EmailContent & { to: string }): void {
  const message: EmailMessage = { sender: "accounts", tag: kind, ...content };
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
      discord: {
        clientId: env.DISCORD_CLIENT_ID,
        clientSecret: env.DISCORD_CLIENT_SECRET,
      },
    },
    // "Link Discord" (services spec §4.2) and the payout destination's "Log in with PayPal" link a
    // second identity onto a signed-in account; the two identities may use different email addresses.
    // No trustedProviders: a trusted provider would let a sign-in with an unverified provider email
    // take over the Payleor account with that email.
    account: {
      accountLinking: {
        allowDifferentEmails: true,
      },
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    plugins: [
      organization({
        // A store needs a slug, so no team is created automatically with an organization.
        teams: { enabled: true, defaultTeam: { enabled: false } },
        schema: { team: { additionalFields: teamFields } },
        organizationHooks: {
          beforeCreateTeam: async ({ team, user }) => {
            if (team.product !== undefined && team.product !== null && !isTeamProduct(team.product)) {
              throw new APIError("BAD_REQUEST", {
                code: "TEAM_PRODUCT_INVALID",
                message: "A team's product is 'store' or 'services'.",
              });
            }
            const product: TeamProduct = team.product === "services" ? "services" : "store";
            const slug = await claimTeamSlug(database, team.slug, product);
            // The store columns stay on every team (contract §4.2); services teams never read them.
            return {
              data: {
                slug,
                product,
                status: "draft",
                paypalMerchantId: null,
                supportEmail: product === "store" ? (user?.email ?? null) : null,
              },
            };
          },
          afterCreateTeam: async ({ team }) => {
            if (team.product === "services") await createServicesTeamSettings(database, team.id);
          },
          // Store URLs and the KV cache are keyed by slug, so slugs cannot change until W1-C adds invalidation.
          // A team's product picks its repository filters and dashboard; changing it would strand its data.
          beforeUpdateTeam: async ({ team, updates }) => {
            if (updates.slug !== undefined && updates.slug !== team.slug) {
              throw new APIError("BAD_REQUEST", {
                code: "TEAM_SLUG_IMMUTABLE",
                message: "A team address cannot be changed.",
              });
            }
            if (updates.product !== undefined && updates.product !== team.product) {
              throw new APIError("BAD_REQUEST", {
                code: "TEAM_PRODUCT_IMMUTABLE",
                message: "A team's product cannot be changed.",
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
