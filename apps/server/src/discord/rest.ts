// Discord REST helper for the bot token (contract §4.3). Later plans post and edit ticket cards with
// it; the interactions webhook calls live in interactions.ts because they need no token.
const DISCORD_API = "https://discord.com/api/v10";

export type DiscordChannelMessage = {
  content?: string;
  allowed_mentions?: { parse: [] };
  // Later plans add embeds and components for ticket cards (spec §5.2).
  embeds?: unknown[];
  components?: unknown[];
};

export type DiscordRest = {
  postChannelMessage(channelId: string, message: DiscordChannelMessage): Promise<void>;
  editChannelMessage(channelId: string, messageId: string, message: DiscordChannelMessage): Promise<void>;
};

export function createDiscordRest(input: { token: string; fetch?: typeof fetch }): DiscordRest {
  const fetchImpl = input.fetch ?? fetch;
  const headers = { authorization: `Bot ${input.token}`, "content-type": "application/json" };

  async function call(method: string, path: string, body: DiscordChannelMessage): Promise<void> {
    const response = await fetchImpl(`${DISCORD_API}${path}`, {
      method,
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Discord ${method} ${path} failed: ${response.status}`);
    }
    // An unread body holds the connection open on Workers.
    await response.body?.cancel();
  }

  return {
    // Create Message: POST /channels/{channel.id}/messages.
    postChannelMessage(channelId, message) {
      return call("POST", `/channels/${channelId}/messages`, message);
    },
    // Edit Message: PATCH /channels/{channel.id}/messages/{message.id}.
    editChannelMessage(channelId, messageId, message) {
      return call("PATCH", `/channels/${channelId}/messages/${messageId}`, message);
    },
  };
}
