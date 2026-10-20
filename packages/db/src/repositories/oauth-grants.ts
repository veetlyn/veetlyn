import { and, eq } from "drizzle-orm";

import type { Database } from "../index";
import { oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken } from "../schema/oauth";

// The AI clients a user has approved, newest first: what the account page lists to disconnect.
export async function listConnectedApps(db: Database, userId: string) {
  return db
    .select({ clientId: oauthConsent.clientId, name: oauthClient.name, uri: oauthClient.uri, connectedAt: oauthConsent.createdAt })
    .from(oauthConsent)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .where(eq(oauthConsent.userId, userId))
    .orderBy(oauthConsent.createdAt);
}

// Ends a user's grants, to one client or to all: the consent goes, and so do the refresh tokens, which would
// otherwise keep minting access tokens. Access tokens already issued run until they expire.
export async function revokeOAuthGrants(db: Database, input: { userId: string; clientId?: string }) {
  const forUser = <T extends typeof oauthConsent | typeof oauthRefreshToken | typeof oauthAccessToken>(table: T) =>
    input.clientId ? and(eq(table.userId, input.userId), eq(table.clientId, input.clientId)) : eq(table.userId, input.userId);
  await db.transaction(async (tx) => {
    await tx.delete(oauthAccessToken).where(forUser(oauthAccessToken));
    await tx.delete(oauthRefreshToken).where(forUser(oauthRefreshToken));
    await tx.delete(oauthConsent).where(forUser(oauthConsent));
  });
}

// The distinct hosts a client may receive codes at.
export async function clientRedirectHosts(db: Database, clientId: string): Promise<Set<string> | null> {
  const [row] = await db.select({ redirectUris: oauthClient.redirectUris }).from(oauthClient).where(eq(oauthClient.clientId, clientId)).limit(1);
  if (!row) return null;
  return new Set(row.redirectUris.flatMap((uri) => (URL.canParse(uri) ? [new URL(uri).host] : [])));
}
