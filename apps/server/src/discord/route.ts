import { errorName } from "@jendal-workspace/core";
import { log } from "evlog";
import { Hono } from "hono";

import { ENV } from "../env.server";
import { getDb } from "../services";
import type { AppEnv } from "../app-env";
import {
  DEFERRED_EPHEMERAL_RESPONSE,
  type DiscordConfig,
  type DiscordInteraction,
  editOriginalInteractionResponse,
  handleDiscordInteraction,
} from "./interactions";
import { verifyDiscordSignature } from "./verify";

const config: DiscordConfig = {
  applicationId: ENV.DISCORD_APP_ID,
  webBaseUrl: ENV.BETTER_AUTH_URL,
};

export const discordRoute = new Hono<AppEnv>().post("/discord/interactions", async (c) => {
  const timestamp = c.req.header("x-signature-timestamp") ?? "";
  const signature = c.req.header("x-signature-ed25519") ?? "";
  const body = await c.req.text();
  if (!(await verifyDiscordSignature(ENV.DISCORD_PUBLIC_KEY, timestamp, body, signature))) {
    // Discord expects 401 for an invalid signature (Fact 1).
    return c.text("invalid request signature", 401);
  }

  // The deferred follow-up needs the database after the response is sent, and the global middleware
  // closes its db with the request (Fact 19), so the follow-up gets its own connection, opened here
  // and closed with it.
  const db = getDb();
  try {
    // SAFETY: the body passed Discord's signature check above, so it is an interaction Discord sent.
    const interaction = JSON.parse(body) as DiscordInteraction;
    const result = await handleDiscordInteraction(config, { db }, interaction);
    if (result.kind === "reply") {
      await db.$client.end();
      return c.json(result.response);
    }
    c.executionCtx.waitUntil(
      (async () => {
        try {
          const content = await result.followUp.catch((cause: unknown) => {
            log.error({
              action: "discord.followup",
              error: { name: errorName(cause) },
            });
            return "Something went wrong. Please run the command again.";
          });
          await editOriginalInteractionResponse(config, interaction.token, { content });
        } catch (error) {
          log.error({
            action: "discord.followup",
            error: { name: errorName(error) },
          });
        } finally {
          await db.$client.end().catch(() => undefined);
        }
      })(),
    );
    return c.json(DEFERRED_EPHEMERAL_RESPONSE);
  } catch (error) {
    await db.$client.end().catch(() => undefined);
    throw error;
  }
});
