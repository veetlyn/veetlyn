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

// Ends a user's grants, to one client or to all: the consent goes, and so do the tokens. Access tokens are
// signed JWTs checked without a database, so the MCP endpoint also requires the consent they were issued under.
export async function revokeOAuthGrants(db: Database, input: { userId: string; clientId?: string }) {
  const forUser = <T extends typeof oauthConsent | typeof oauthRefreshToken | typeof oauthAccessToken>(table: T) =>
    input.clientId ? and(eq(table.userId, input.userId), eq(table.clientId, input.clientId)) : eq(table.userId, input.userId);
  await db.transaction(async (tx) => {
    await tx.delete(oauthAccessToken).where(forUser(oauthAccessToken));
    await tx.delete(oauthRefreshToken).where(forUser(oauthRefreshToken));
    await tx.delete(oauthConsent).where(forUser(oauthConsent));
  });
}

// When the user approved this client, or null once the grant was revoked.
export async function consentGrantedAt(db: Database, input: { userId: string; clientId: string }): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: oauthConsent.createdAt })
    .from(oauthConsent)
    .where(and(eq(oauthConsent.userId, input.userId), eq(oauthConsent.clientId, input.clientId)))
    .limit(1);
  return row ? (row.createdAt ?? new Date(0)) : null;
}

// The distinct places a client may receive codes at: scheme and host. A custom scheme has no host (its origin is
// "null" for every app), and a URI that does not parse has none either, so each such URI counts on its own.
function redirectPlace(uri: string): string {
  if (!URL.canParse(uri)) return uri;
  const url = new URL(uri);
  return url.host ? `${url.protocol}//${url.host}` : uri;
}

export async function clientRedirectOrigins(db: Database, clientId: string): Promise<Set<string> | null> {
  const [row] = await db.select({ redirectUris: oauthClient.redirectUris }).from(oauthClient).where(eq(oauthClient.clientId, clientId)).limit(1);
  if (!row) return null;
  return new Set(row.redirectUris.map(redirectPlace));
}
