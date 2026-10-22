import { canServicesTeam } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import {
  consumeDiscordLinkCode,
  findUserIdByDiscordId,
  setServicesTeamDiscordGuildId,
} from "@jendal-workspace/db/repositories/discord";
import { servicesTeamRoleFor } from "@jendal-workspace/db/repositories/services-teams";

import { discordCommandName } from "./commands";

// Interaction types (Fact 3). Only PING, commands and autocomplete arrive today; components and
// modals come with later plans (services spec §8.4) and get the polite default meanwhile.
const INTERACTION_PING = 1;
const INTERACTION_APPLICATION_COMMAND = 2;
const INTERACTION_AUTOCOMPLETE = 4;

// Callback types (Fact 3): 4 answers at once, 5 defers within the 3-second limit (Fact 4), 8 answers
// autocomplete, 1 answers a PING.
const CALLBACK_PONG = 1;
const CALLBACK_CHANNEL_MESSAGE_WITH_SOURCE = 4;
const CALLBACK_DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE = 5;
const CALLBACK_AUTOCOMPLETE_RESULT = 8;

// Only the invoking user sees the reply (Fact 5).
const EPHEMERAL = 1 << 6;
// Required in the guild before a server link is accepted (Fact 7).
const MANAGE_GUILD = 1 << 5;

const DISCORD_API = "https://discord.com/api/v10";

export type DiscordInteractionOption = {
  name: string;
  type: number;
  value?: string;
  options?: DiscordInteractionOption[];
};

// Only the fields the platform reads (Fact 3): the invoker as member (guild) or user (DM), the guild,
// the command data and the interaction token.
export type DiscordInteraction = {
  id: string;
  token: string;
  type: number;
  data?: { name?: string; options?: DiscordInteractionOption[] };
  guild_id?: string;
  member?: { user: { id: string }; permissions?: string };
  user?: { id: string };
};

export type DiscordConfig = {
  applicationId: string;
  // The admin origin (BETTER_AUTH_URL); /payouts setup links to /me/payouts there.
  webBaseUrl: string;
  // The product name people read (PLATFORM_NAME).
  platformName: string;
};

export type InteractionResponse = { type: number; data?: { content?: string; flags?: number; choices?: unknown[] } };

// The route's answer for a deferred result; only EPHEMERAL is valid on a defer (Fact 5).
export const DEFERRED_EPHEMERAL_RESPONSE: InteractionResponse = {
  type: CALLBACK_DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
  data: { flags: EPHEMERAL },
};

export type InteractionResult =
  | { kind: "reply"; response: InteractionResponse }
  | { kind: "deferred"; followUp: Promise<string> };

function ephemeral(content: string): InteractionResult {
  return {
    kind: "reply",
    response: { type: CALLBACK_CHANNEL_MESSAGE_WITH_SOURCE, data: { flags: EPHEMERAL, content } },
  };
}

export async function handleDiscordInteraction(
  config: DiscordConfig,
  services: { db: Database },
  interaction: DiscordInteraction,
): Promise<InteractionResult> {
  switch (interaction.type) {
    case INTERACTION_PING:
      // Discord only saves the endpoint URL after a PING is acknowledged (Fact 2).
      return { kind: "reply", response: { type: CALLBACK_PONG } };
    case INTERACTION_APPLICATION_COMMAND:
      return dispatchCommand(config, services, interaction);
    case INTERACTION_AUTOCOMPLETE:
      return { kind: "reply", response: { type: CALLBACK_AUTOCOMPLETE_RESULT, data: { choices: [] } } };
    default:
      return ephemeral(`${config.platformName} cannot handle this interaction yet.`);
  }
}

function subcommand(interaction: DiscordInteraction) {
  const command = interaction.data?.options?.find((candidate) => candidate.type === 1);
  return {
    name: command?.name ?? "",
    option: (optionName: string) => command?.options?.find((candidate) => candidate.name === optionName)?.value,
  };
}

function dispatchCommand(
  config: DiscordConfig,
  services: { db: Database },
  interaction: DiscordInteraction,
): InteractionResult {
  const command = interaction.data?.name ?? "";
  const rootCommand = discordCommandName(config.platformName);
  const sub = subcommand(interaction);
  if (command === "payouts" && sub.name === "setup") {
    return ephemeral(`Set up your PayPal payout destination on ${config.platformName}: ${config.webBaseUrl}/me/payouts`);
  }
  if (command === rootCommand && sub.name === "link") {
    // Linking a server touches the database, so it may pass the 3-second window: the reply defers
    // (only EPHEMERAL is valid on a defer, Fact 5) and the route edits the original response with
    // the follow-up (Fact 4). Expected failures resolve into user-facing messages here; anything
    // unexpected rejects and the route posts a fallback.
    return {
      kind: "deferred",
      followUp: linkServer(config, services, interaction, sub.option("code") ?? ""),
    };
  }
  return ephemeral(`${config.platformName} does not know this command. Run /${rootCommand} link or /payouts setup.`);
}

async function linkServer(
  config: DiscordConfig,
  services: { db: Database },
  interaction: DiscordInteraction,
  code: string,
): Promise<string> {
  const guildId = interaction.guild_id;
  const discordId = interaction.member?.user.id;
  const permissions = interaction.member?.permissions;
  if (!guildId || !discordId) {
    return `Run this command in the server you want to link to your ${config.platformName} team.`;
  }
  if (!permissions || (BigInt(permissions) & BigInt(MANAGE_GUILD)) !== BigInt(MANAGE_GUILD)) {
    return `You need the Manage Server permission in this server to link it to ${config.platformName}.`;
  }
  // Consumed first and atomically, so the one-time code cannot be raced or replayed.
  const teamId = await consumeDiscordLinkCode(services.db, code);
  if (!teamId) {
    return `That code is not valid. An admin of your team creates a link code in the team admin on ${config.platformName}.`;
  }
  const userId = await findUserIdByDiscordId(services.db, discordId);
  if (!userId) {
    return `First, link your Discord account to ${config.platformName} in Account settings (${config.webBaseUrl}/account), then run the command again.`;
  }
  const role = await servicesTeamRoleFor(services.db, teamId, userId);
  if (!canServicesTeam(role, "manage_connections")) {
    return `Your ${config.platformName} account is not an admin of that team, so it cannot link the server.`;
  }
  const result = await setServicesTeamDiscordGuildId(services.db, teamId, guildId);
  if (result === "conflict") {
    return `Another ${config.platformName} team is already linked to this server.`;
  }
  if (result === "missing") {
    return `Your team's settings are missing on ${config.platformName}. Open the team admin and try again.`;
  }
  return `This server is now linked to your ${config.platformName} team. The Link Discord step in your team's setup checklist is done.`;
}

// Edits the deferred original response through the interaction webhook; no bot token needed (Fact 4).
export async function editOriginalInteractionResponse(
  config: DiscordConfig,
  token: string,
  message: { content: string },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(`${DISCORD_API}/webhooks/${config.applicationId}/${token}/messages/@original`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message),
  });
  if (!response.ok) {
    throw new Error(`Editing the interaction response failed: ${response.status}`);
  }
}
