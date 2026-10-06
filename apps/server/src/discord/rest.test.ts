import { describe, expect, it } from "vitest";

import { createDiscordRest } from "./rest";

function stubFetch(status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchStub = (async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response("{}", { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, fetchStub };
}

describe("createDiscordRest", () => {
  it("posts a channel message with the bot token", async () => {
    const { calls, fetchStub } = stubFetch();
    const rest = createDiscordRest({ token: "BOT-TOKEN", fetch: fetchStub });

    await rest.postChannelMessage("channel-1", { content: "hello" });

    expect(calls[0]?.url).toBe("https://discord.com/api/v10/channels/channel-1/messages");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toEqual({ authorization: "Bot BOT-TOKEN", "content-type": "application/json" });
    expect(calls[0]?.init.body).toBe('{"content":"hello"}');
  });

  it("edits a channel message", async () => {
    const { calls, fetchStub } = stubFetch();
    const rest = createDiscordRest({ token: "BOT-TOKEN", fetch: fetchStub });

    await rest.editChannelMessage("channel-1", "message-1", { content: "edited" });

    expect(calls[0]?.url).toBe("https://discord.com/api/v10/channels/channel-1/messages/message-1");
    expect(calls[0]?.init.method).toBe("PATCH");
  });

  it("throws with the status when Discord rejects the request", async () => {
    const { fetchStub } = stubFetch(403);
    const rest = createDiscordRest({ token: "BOT-TOKEN", fetch: fetchStub });

    await expect(rest.postChannelMessage("channel-1", { content: "hello" })).rejects.toThrow("403");
  });
});
