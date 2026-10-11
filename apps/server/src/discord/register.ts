// Run with `pnpm -F server discord:register`, which wraps bun in `varlock run`: apps/server/bunfig.toml
// turns off bun's own .env loading (Fact 21). Never log the token or the request headers.
import { z } from "zod";

import { DISCORD_COMMANDS } from "./commands";

const applicationId = process.env.DISCORD_APP_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;

if (!applicationId || !botToken) {
  console.error("DISCORD_APP_ID and DISCORD_BOT_TOKEN are not set. Run this through `pnpm -F server discord:register`.");
  process.exit(1);
}

// The bulk PUT overwrites the whole global command list, so removed commands disappear with it
// (Fact 6). Global commands take a few minutes to reach every server.
const response = await fetch(`https://discord.com/api/v10/applications/${applicationId}/commands`, {
  method: "PUT",
  headers: { authorization: `Bot ${botToken}`, "content-type": "application/json" },
  body: JSON.stringify(DISCORD_COMMANDS),
});

if (!response.ok) {
  console.error(`Discord answered ${response.status}: ${await response.text()}`);
  process.exit(1);
}

const commands = z.array(z.object({ name: z.string() })).parse(await response.json());
console.log(`Registered ${commands.length} global commands: ${commands.map((command) => command.name).join(", ")}`);
