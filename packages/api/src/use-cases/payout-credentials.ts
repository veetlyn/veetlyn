import { errorName, openSecret, sealSecret } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { DbExecutor, Transaction } from "@jendal-workspace/db/executor";
import {
  deleteTeamPayoutCredentials,
  getTeamPayoutCredentials,
  lockTeamPayoutCredentials,
  saveTeamPayoutCredentials,
  type TeamPayoutCredentialsRow,
} from "@jendal-workspace/db/repositories/payout-credentials";
import { hasActivePayoutSend } from "@jendal-workspace/db/repositories/payout-requests";
import { getServicesTeamSettings } from "@jendal-workspace/db/repositories/services-teams";
import { PayPalError, type PayPalBalances, type PayPalClient } from "@jendal-workspace/paypal";
import { TRPCError } from "@trpc/server";
import { log } from "evlog";

import type { PayoutServices } from "../context";

// accountId is null when PayPal did not report which account the credentials belong to.
export type PayoutCredentialsView = { clientIdEnding: string; accountId: string | null; verifiedAt: string };

type PayoutTeam = { id: string; paypalMerchantId: string | null };

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
  return { clientIdEnding: row.clientId.slice(-4), accountId: row.paypalAccountId, verifiedAt: row.verifiedAt.toISOString() };
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
// and belong to the PayPal account connected to the team. The PayPal call happens before any lock is taken.
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

  const client = payouts.clientFor({ teamId: team.id, clientId: input.clientId, clientSecret: input.clientSecret });
  const { accountId } = await readBalances(client, settings?.currency ?? "USD", team.id);
  if (accountId !== null && accountId !== team.paypalMerchantId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "These credentials belong to another PayPal account than the one connected to this team.",
    });
  }
  if (accountId === null) {
    log.warn({ action: "payout_credentials.account", team: { id: team.id }, account: { reported: false } });
  }

  const sealed = await sealSecret(payouts.secretKey, payouts.keyId, input.clientSecret, team.id);
  const row = await writeUnlessSendingElsewhere(
    db,
    team.id,
    (current) => accountId !== null && current?.paypalAccountId === accountId,
    (tx) =>
      saveTeamPayoutCredentials(tx, {
        teamId: team.id,
        clientId: input.clientId,
        secretCiphertext: sealed.ciphertext,
        secretIv: sealed.iv,
        keyId: sealed.keyId,
        paypalAccountId: accountId,
        verifiedAt: new Date(),
      }),
  );
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

// Null when the team has saved no credentials.
export async function payoutClientForTeam(
  db: DbExecutor,
  payouts: PayoutServices,
  teamId: string,
): Promise<PayPalClient | null> {
  const row = await getTeamPayoutCredentials(db, teamId);
  return row ? payoutClientFromCredentials(payouts, row) : null;
}
