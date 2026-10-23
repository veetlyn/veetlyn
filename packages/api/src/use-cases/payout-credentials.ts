import { maskedPayPalAccountId, openSecret, sealSecret, type ServicesTeamRecord } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { DbExecutor, Transaction } from "@jendal-workspace/db/executor";
import {
  deleteTeamPayoutCredentials,
  getPayoutConnectAttempt,
  getTeamPayoutCredentials,
  insertPayoutConnectAttempt,
  lockPayoutConnectAttempt,
  lockTeamPayoutCredentials,
  markPayoutConnectAttemptUsed,
  type PayoutConnectAttemptRow,
  saveTeamPayoutCredentials,
  type TeamPayoutCredentialsRow,
} from "@jendal-workspace/db/repositories/payout-credentials";
import { hasActivePayoutSend } from "@jendal-workspace/db/repositories/payout-requests";
import { saveTeamPayPalCountry } from "@jendal-workspace/db/repositories/paypal-onboarding";
import { getServicesTeamSettings } from "@jendal-workspace/db/repositories/services-teams";
import {
  actionUrlFromLinks,
  FIRST_PARTY_REFERRAL_FEATURES,
  PayPalError,
  type PayPalClient,
  type SellerCredentials,
} from "@jendal-workspace/paypal";
import { TRPCError } from "@trpc/server";
import { log } from "evlog";

import type { PayoutServices, PayPalServices } from "../context";
import { PAYPAL_URL_MAX_LENGTH, payPalCountry } from "../paypal/onboarding";
import { payPalErrorLog } from "./paypal-amounts";

// accountId is null for credentials saved before PayPal reported which account they belong to. canReadBalance is
// false for credentials whose token lacks the reporting scope, such as those saved before the platform asked for it.
export type PayoutCredentialsView = { accountId: string | null; verifiedAt: string; canReadBalance: boolean };

type PayoutTeam = Pick<ServicesTeamRecord, "id" | "slug" | "paypalMerchantId">;

const CONNECT_ATTEMPT_TTL_MS = 3_600_000;
const SELLER_NONCE_BYTES = 64;
const CONNECTION_UNCONFIRMED = "PayPal did not confirm the connection. Try again.";
const CONNECT_EXPIRED = "This PayPal connection expired. Turn on automatic payouts again.";
const PAYOUTS_SCOPE = "https://uri.paypal.com/payments/payouts";
const REPORTING_SCOPE = "https://uri.paypal.com/services/reporting/search/read";

export function requirePayoutServices(payouts: PayoutServices | undefined): PayoutServices {
  if (!payouts) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Payouts are not set up on this server." });
  return payouts;
}

// Payouts go out only from the PayPal account connected to the team. Credentials whose account PayPal did not
// report cannot be checked, and are allowed.
export function credentialsMatchTeam(
  row: Pick<TeamPayoutCredentialsRow, "paypalAccountId">,
  team: Pick<PayoutTeam, "paypalMerchantId">,
): boolean {
  return row.paypalAccountId === null || row.paypalAccountId === team.paypalMerchantId;
}

function toView(row: TeamPayoutCredentialsRow): PayoutCredentialsView {
  return { accountId: row.paypalAccountId, verifiedAt: row.verifiedAt.toISOString(), canReadBalance: row.canReadBalance };
}

export async function getPayoutCredentialsView(db: DbExecutor, teamId: string): Promise<PayoutCredentialsView | null> {
  const row = await getTeamPayoutCredentials(db, teamId);
  return row ? toView(row) : null;
}

function payoutsInProgress(): TRPCError {
  return new TRPCError({ code: "CONFLICT", message: "Wait for the payouts in progress to finish." });
}

// Runs `write` holding the credentials row lock, after re-checking for payouts in progress under it; a send claim
// takes the same row `for share`, so none can start between the check and the write. While payouts are in
// progress, only credentials of the same PayPal account may replace the current ones: the settle step reads the
// batch with whatever credentials are saved, and only an app of the sending account can read it.
async function writeUnlessSendingElsewhere<T>(
  db: Database,
  teamId: string,
  allowedWhileSending: (current: TeamPayoutCredentialsRow | null) => boolean,
  write: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const current = await lockTeamPayoutCredentials(tx, teamId);
    if ((await hasActivePayoutSend(tx, teamId)) && !allowedWhileSending(current)) throw payoutsInProgress();
    return write(tx);
  });
}

async function requirePayoutTeam(db: Database, team: PayoutTeam): Promise<{ merchantId: string }> {
  const settings = await getServicesTeamSettings(db, team.id);
  if (settings?.solo) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A solo seller has no payouts to send." });
  }
  if (!team.paypalMerchantId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Connect PayPal first." });
  return { merchantId: team.paypalMerchantId };
}

function sellerNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SELLER_NONCE_BYTES));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

// Starts PayPal's first-party onboarding for a team whose PayPal account is already connected: the admin consents
// in PayPal's mini-browser, which hands the page an authorization code for connectComplete.
export async function startPayoutConnect(
  deps: { db: Database; paypal: PayPalServices },
  input: { team: PayoutTeam; userId: string },
): Promise<{ actionUrl: string; attemptId: string }> {
  const { db, paypal } = deps;
  const { team } = input;
  await requirePayoutTeam(db, team);
  const returnUrl = new URL(`/${team.slug}/payouts`, paypal.returnUrl).toString();
  if (returnUrl.length > PAYPAL_URL_MAX_LENGTH) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The PayPal return URL is longer than 127 characters." });
  }
  // The attempt is saved only once PayPal has started the onboarding, under the id and nonce PayPal was given.
  const attempt = { id: crypto.randomUUID(), teamId: team.id, sellerNonce: sellerNonce(), createdByUserId: input.userId };
  let actionUrl: string | null;
  try {
    const referral = await paypal.client.partnerReferrals.createFirstParty({
      requestId: `payout-connect:${attempt.id}`,
      returnUrl,
      sellerNonce: attempt.sellerNonce,
      features: FIRST_PARTY_REFERRAL_FEATURES,
    });
    actionUrl = actionUrlFromLinks(referral.links);
  } catch (cause) {
    log.warn({ action: "payout_connect.start", team: { id: team.id }, error: payPalErrorLog(cause) });
    throw new TRPCError({ code: "BAD_GATEWAY", message: "PayPal did not answer. Try again.", cause });
  }
  if (!actionUrl) throw new Error("PayPal's first-party referral response has no action_url link.");
  await insertPayoutConnectAttempt(db, attempt);
  return { actionUrl, attemptId: attempt.id };
}

// Only the admin who started the attempt may complete it: the authorization code is bound to its nonce.
function usableAttempt(
  attempt: PayoutConnectAttemptRow | null,
  teamId: string,
  userId: string,
): attempt is PayoutConnectAttemptRow {
  return (
    attempt !== null &&
    attempt.teamId === teamId &&
    attempt.createdByUserId === userId &&
    attempt.usedAt === null &&
    attempt.createdAt.getTime() > Date.now() - CONNECT_ATTEMPT_TTL_MS
  );
}

function connectExpired(): TRPCError {
  return new TRPCError({ code: "BAD_REQUEST", message: CONNECT_EXPIRED });
}

async function sellerCredentialsFor(
  paypal: PayPalServices,
  attempt: PayoutConnectAttemptRow,
  input: { authCode: string; sharedId: string },
): Promise<SellerCredentials> {
  try {
    const sellerToken = await paypal.client.sellerCredentials.exchangeSellerAuthCode({
      sharedId: input.sharedId,
      authCode: input.authCode,
      codeVerifier: attempt.sellerNonce,
    });
    return await paypal.client.sellerCredentials.getSellerCredentials(sellerToken, paypal.partnerId);
  } catch (cause) {
    log.warn({ action: "payout_connect.credentials", team: { id: attempt.teamId }, error: payPalErrorLog(cause) });
    throw new TRPCError({ code: "BAD_GATEWAY", message: CONNECTION_UNCONFIRMED, cause });
  }
}

async function requirePayoutsScope(client: PayPalClient, teamId: string): Promise<string[]> {
  let scopes: string[];
  try {
    scopes = await client.grantedScopes();
  } catch (cause) {
    log.warn({ action: "payout_connect.verify", team: { id: teamId }, error: payPalErrorLog(cause) });
    if (cause instanceof PayPalError && cause.status === 401) {
      throw new TRPCError({ code: "BAD_GATEWAY", message: CONNECTION_UNCONFIRMED, cause });
    }
    throw new TRPCError({ code: "BAD_GATEWAY", message: "PayPal did not answer. Try again.", cause });
  }
  if (!scopes.includes(PAYOUTS_SCOPE)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "PayPal has not turned on Payouts for this PayPal account. Ask PayPal to turn it on, then try again.",
    });
  }
  return scopes;
}

// Teams connected before the platform kept the PayPal country get it here. Payout fees fall back to the international
// estimate without it, so a failure only logs.
async function refreshTeamPayPalCountry(db: Database, paypal: PayPalServices, teamId: string, merchantId: string) {
  try {
    const integration = await paypal.client.merchantIntegrations.get(paypal.partnerId, merchantId);
    const country = payPalCountry(integration.country);
    if (country) await saveTeamPayPalCountry(db, { teamId, country });
  } catch (cause) {
    log.warn({ action: "payout_connect.country", team: { id: teamId }, error: payPalErrorLog(cause) });
  }
}

function otherAccount(merchantId: string): TRPCError {
  return new TRPCError({
    code: "PRECONDITION_FAILED",
    message: `Connect the PayPal account this team already uses (${maskedPayPalAccountId(merchantId)}).`,
  });
}

// PayPal shares the team's own REST credentials after consent. They are kept only when they belong to the PayPal
// account connected to the team and their token carries the payouts scope. Their balance can be read only when the
// token also carries the reporting scope. PayPal's calls happen before any lock is taken.
export async function completePayoutConnect(
  deps: { db: Database; payouts: PayoutServices; paypal: PayPalServices },
  input: { team: PayoutTeam; userId: string; attemptId: string; authCode: string; sharedId: string },
): Promise<PayoutCredentialsView> {
  const { db, payouts, paypal } = deps;
  const { team } = input;
  const { merchantId } = await requirePayoutTeam(db, team);
  const attempt = await getPayoutConnectAttempt(db, input.attemptId);
  if (!usableAttempt(attempt, team.id, input.userId)) throw connectExpired();

  const credentials = await sellerCredentialsFor(paypal, attempt, input);
  if (credentials.payerId !== merchantId) throw otherAccount(merchantId);
  const client = payouts.clientFor({ teamId: team.id, clientId: credentials.clientId, clientSecret: credentials.clientSecret });
  const scopes = await requirePayoutsScope(client, team.id);

  const sealed = await sealSecret(payouts.secretKey, payouts.keyId, credentials.clientSecret, team.id);
  const row = await writeUnlessSendingElsewhere(
    db,
    team.id,
    (current) => current?.paypalAccountId === merchantId,
    async (tx) => {
      const locked = await lockPayoutConnectAttempt(tx, attempt.id);
      if (!usableAttempt(locked, team.id, input.userId)) throw connectExpired();
      const saved = await saveTeamPayoutCredentials(tx, {
        teamId: team.id,
        clientId: credentials.clientId,
        secretCiphertext: sealed.ciphertext,
        secretIv: sealed.iv,
        keyId: sealed.keyId,
        paypalAccountId: merchantId,
        verifiedAt: new Date(),
        canReadBalance: scopes.includes(REPORTING_SCOPE),
      });
      await markPayoutConnectAttemptUsed(tx, attempt.id);
      return saved;
    },
  );
  await refreshTeamPayPalCountry(db, paypal, team.id, merchantId);
  return toView(row);
}

export async function removeTeamPayoutCredentials(db: Database, teamId: string): Promise<void> {
  await writeUnlessSendingElsewhere(
    db,
    teamId,
    () => false,
    (tx) => deleteTeamPayoutCredentials(tx, teamId),
  );
}

// Builds the client from a row the caller already holds, such as the one a send claim locked.
export async function payoutClientFromCredentials(
  payouts: PayoutServices,
  row: TeamPayoutCredentialsRow,
): Promise<PayPalClient> {
  const clientSecret = await openSecret(
    payouts.secretKey,
    { ciphertext: row.secretCiphertext, iv: row.secretIv, keyId: row.keyId },
    row.teamId,
  );
  return payouts.clientFor({ teamId: row.teamId, clientId: row.clientId, clientSecret });
}
