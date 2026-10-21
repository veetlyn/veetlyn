// Run with `pnpm -F server discord:register`, which wraps bun in `varlock run`: apps/server/bunfig.toml
// turns off bun's own .env loading (Fact 21). Never log the token or the request headers.
import { z } from "zod";

import { discordCommands } from "./commands";

const applicationId = process.env.DISCORD_APP_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
const platformName = process.env.PLATFORM_NAME;

if (!applicationId || !botToken || !platformName) {
  console.error("DISCORD_APP_ID, DISCORD_BOT_TOKEN and PLATFORM_NAME are not set. Run this through `pnpm -F server discord:register`.");
  process.exit(1);
}

// The bulk PUT overwrites the whole global command list, so removed commands disappear with it
// (Fact 6). Global commands take a few minutes to reach every server.
const response = await fetch(`https://discord.com/api/v10/applications/${applicationId}/commands`, {
  method: "PUT",
  headers: { authorization: `Bot ${botToken}`, "content-type": "application/json" },
  body: JSON.stringify(discordCommands(platformName)),
});

if (!response.ok) {
  console.error(`Discord answered ${response.status}: ${await response.text()}`);
  process.exit(1);
}

const commands = z.array(z.object({ name: z.string() })).parse(await response.json());
console.log(`Registered ${commands.length} global commands: ${commands.map((command) => command.name).join(", ")}`);
