import { and, eq, gt } from "drizzle-orm";

import type { Database } from "../index";
import { account } from "../schema/auth";
import { discordLinkCode, servicesTeamSettings } from "../schema/services-teams";

// The Payleor user behind a Discord account: a Better Auth account row whose provider is "discord"
// and whose account ID is the Discord snowflake (Fact 10).
export async function findUserIdByDiscordId(db: Database, discordId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: account.userId })
    .from(account)
    .where(and(eq(account.providerId, "discord"), eq(account.accountId, discordId)))
    .limit(1);
  return row?.userId ?? null;
}

export type DiscordLinkCode = { code: string; expiresAt: Date };

// A one-time code an admin creates in the team admin and runs as /payleor link code:… (services spec §4.2).
export async function createDiscordLinkCode(
  db: Database,
  teamId: string,
  { minutes = 15 }: { minutes?: number } = {},
): Promise<DiscordLinkCode> {
  const expiresAt = new Date(Date.now() + minutes * 60_000);
  const code = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  await db.insert(discordLinkCode).values({ teamId, code, expiresAt });
  return { code, expiresAt };
}

// The delete is the consumption: an expired or already-used code returns nothing.
export async function consumeDiscordLinkCode(db: Database, code: string): Promise<string | null> {
  const rows = await db
    .delete(discordLinkCode)
    .where(and(eq(discordLinkCode.code, code), gt(discordLinkCode.expiresAt, new Date())))
    .returning({ teamId: discordLinkCode.teamId });
  return rows[0]?.teamId ?? null;
}

export async function findTeamIdByDiscordGuildId(db: Database, guildId: string): Promise<string | null> {
  const [row] = await db
    .select({ teamId: servicesTeamSettings.teamId })
    .from(servicesTeamSettings)
    .where(eq(servicesTeamSettings.discordGuildId, guildId))
    .limit(1);
  return row?.teamId ?? null;
}

// "linked" set the guild; "conflict" another team already uses this guild; "missing" the team has no
// settings row. The unique index on discord_guild_id still enforces one team per guild if two links race.
export async function setServicesTeamDiscordGuildId(
  db: Database,
  teamId: string,
  guildId: string,
): Promise<"linked" | "conflict" | "missing"> {
  const owner = await findTeamIdByDiscordGuildId(db, guildId);
  if (owner !== null && owner !== teamId) return "conflict";
  const rows = await db
    .update(servicesTeamSettings)
    .set({ discordGuildId: guildId })
    .where(eq(servicesTeamSettings.teamId, teamId))
    .returning({ teamId: servicesTeamSettings.teamId });
  return rows.length > 0 ? "linked" : "missing";
}
