import { errorName, openSecret, sealSecret } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { DbExecutor } from "@jendal-workspace/db/executor";
import {
  deleteTeamPayoutCredentials,
  getTeamPayoutCredentials,
  saveTeamPayoutCredentials,
  type TeamPayoutCredentialsRow,
} from "@jendal-workspace/db/repositories/payout-credentials";
import { hasActivePayoutSend } from "@jendal-workspace/db/repositories/payout-requests";
import { getServicesTeamSettings } from "@jendal-workspace/db/repositories/services-teams";
import { PayPalError, type PayPalBalances, type PayPalClient } from "@jendal-workspace/paypal";
import { TRPCError } from "@trpc/server";
import { log } from "evlog";

import type { PayoutServices } from "../context";

export type PayoutCredentialsView = { clientIdEnding: string; accountId: string; verifiedAt: string };

type PayoutTeam = { id: string; paypalMerchantId: string | null };

export function requirePayoutServices(payouts: PayoutServices | undefined): PayoutServices {
  if (!payouts) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Payouts are not set up on this server." });
  return payouts;
}

function toView(row: TeamPayoutCredentialsRow): PayoutCredentialsView {
  return { clientIdEnding: row.clientId.slice(-4), accountId: row.paypalAccountId, verifiedAt: row.verifiedAt.toISOString() };
}

export async function getPayoutCredentialsView(db: DbExecutor, teamId: string): Promise<PayoutCredentialsView | null> {
  const row = await getTeamPayoutCredentials(db, teamId);
  return row ? toView(row) : null;
}

// New credentials while PayPal works on a payout would leave the settle step reading the batch with another app.
async function refuseWhileSending(db: DbExecutor, teamId: string): Promise<void> {
  if (await hasActivePayoutSend(db, teamId)) {
    throw new TRPCError({ code: "CONFLICT", message: "Wait for the payouts in progress to finish." });
  }
}

async function readBalances(client: PayPalClient, currency: string, teamId: string): Promise<PayPalBalances> {
  try {
    return await client.reporting.balances(currency);
  } catch (cause) {
    const status = cause instanceof PayPalError ? cause.status : null;
    log.warn({ action: "payout_credentials.verify", team: { id: teamId }, error: { name: errorName(cause), status } });
    if (status === 401) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "PayPal refused these credentials. Check the client ID and secret.",
      });
    }
    if (status === 403) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "These credentials cannot read the PayPal balance. Turn on the app's balance and payouts features in the PayPal developer dashboard.",
      });
    }
    throw new TRPCError({ code: "BAD_GATEWAY", message: "PayPal did not answer. Try again." });
  }
}

// The credentials are checked against PayPal before they are stored: they must open a token, read the balance
// and belong to the PayPal account connected to the team.
export async function saveTeamPayoutCredentialsChecked(
  deps: { db: Database; payouts: PayoutServices },
  input: { team: PayoutTeam; clientId: string; clientSecret: string },
): Promise<PayoutCredentialsView> {
  const { db, payouts } = deps;
  const { team } = input;
  const settings = await getServicesTeamSettings(db, team.id);
  if (settings?.solo) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A solo seller has no payouts to send." });
  }
  if (!team.paypalMerchantId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Connect PayPal first." });
  await refuseWhileSending(db, team.id);

  const client = payouts.clientFor({ teamId: team.id, clientId: input.clientId, clientSecret: input.clientSecret });
  const balances = await readBalances(client, settings?.currency ?? "USD", team.id);
  if (balances.accountId !== null && balances.accountId !== team.paypalMerchantId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "These credentials belong to another PayPal account than the one connected to this team.",
    });
  }
  if (balances.accountId === null) {
    log.warn({ action: "payout_credentials.account", team: { id: team.id }, account: { reported: false } });
  }

  const sealed = await sealSecret(payouts.secretKey, payouts.keyId, input.clientSecret, team.id);
  const row = await saveTeamPayoutCredentials(db, {
    teamId: team.id,
    clientId: input.clientId,
    secretCiphertext: sealed.ciphertext,
    secretIv: sealed.iv,
    keyId: sealed.keyId,
    paypalAccountId: balances.accountId ?? team.paypalMerchantId,
    verifiedAt: new Date(),
  });
  return toView(row);
}

export async function removeTeamPayoutCredentials(db: DbExecutor, teamId: string): Promise<void> {
  await refuseWhileSending(db, teamId);
  await deleteTeamPayoutCredentials(db, teamId);
}

// Null when the team has saved no credentials.
export async function payoutClientForTeam(
  db: DbExecutor,
  payouts: PayoutServices,
  teamId: string,
): Promise<PayPalClient | null> {
  const row = await getTeamPayoutCredentials(db, teamId);
  if (!row) return null;
  const clientSecret = await openSecret(
    payouts.secretKey,
    { ciphertext: row.secretCiphertext, iv: row.secretIv, keyId: row.keyId },
    teamId,
  );
  return payouts.clientFor({ teamId, clientId: row.clientId, clientSecret });
}
