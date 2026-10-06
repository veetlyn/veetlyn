import { afterEach, describe, expect, it, vi } from "vitest";

import type { EmailMessage } from "./mailer";
import {
  configuredTransports,
  createMailer,
  EmailDeliveryError,
  EmailNotConfiguredError,
  type MailerConfig,
  mailerWithTransports,
  type Transport,
} from "./transport";

const DOMAIN = { EMAIL_DOMAIN: "payleor.com", EMAIL_REPLY_TO: "support@payleor.com" };

const RESEND: MailerConfig = { ...DOMAIN, RESEND_API_KEY: "test-resend-key" };

const RESEND_URL = "https://api.resend.com/emails";

const message: EmailMessage = {
  sender: "accounts",
  tag: "verification",
  to: "ada@example.com",
  subject: "Verify your email for Payleor",
  text: "Hello",
  html: "<p>Hello</p>",
};

function stubFetch(respond: () => Response = () => Response.json({ id: "re_123" })) {
  const fetchMock = vi.fn<typeof fetch>(async () => respond());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function onlyRequest(fetchMock: ReturnType<typeof stubFetch>) {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] ?? [];
  return {
    url: String(url),
    method: init?.method,
    headers: new Headers(init?.headers),
    body: JSON.parse(String(init?.body)) as Record<string, unknown>,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createMailer with a Resend API key", () => {
  it("posts the message to the Resend emails API", async () => {
    const fetchMock = stubFetch();

    await createMailer(RESEND).send(message);

    const request = onlyRequest(fetchMock);
    expect(request.url).toBe(RESEND_URL);
    expect(request.method).toBe("POST");
    expect(request.headers.get("authorization")).toBe("Bearer test-resend-key");
    expect(request.body).toMatchObject({
      from: "Payleor <accounts@payleor.com>",
      to: ["ada@example.com"],
      reply_to: ["support@payleor.com"],
      subject: "Verify your email for Payleor",
      html: "<p>Hello</p>",
      text: "Hello",
      tags: [
        { name: "sender", value: "accounts" },
        { name: "kind", value: "verification" },
      ],
    });
  });

  it("names the party a message is sent for and honours its reply-to address", async () => {
    const fetchMock = stubFetch();

    await createMailer(RESEND).send({
      ...message,
      sender: "stores",
      onBehalfOf: "Ada's Shop",
      replyTo: "ada@shop.example",
      tag: undefined,
    });

    expect(onlyRequest(fetchMock).body).toMatchObject({
      from: "Ada's Shop via Payleor <stores@payleor.com>",
      reply_to: ["ada@shop.example"],
      tags: [{ name: "sender", value: "stores" }],
    });
  });

  it("keeps tag values to the characters Resend accepts", async () => {
    const fetchMock = stubFetch();

    await createMailer(RESEND).send({ ...message, tag: "Password reset!" });

    expect(onlyRequest(fetchMock).body.tags).toEqual([
      { name: "sender", value: "accounts" },
      { name: "kind", value: "Password_reset_" },
    ]);
  });

  it("rejects when Resend refuses the message", async () => {
    stubFetch(() => Response.json({ name: "validation_error", message: "Domain not verified" }, { status: 403 }));

    await expect(createMailer(RESEND).send(message)).rejects.toThrow();
  });

  it("rejects without calling Resend when EMAIL_DOMAIN is not a hostname", async () => {
    const fetchMock = stubFetch();

    const mailer = createMailer({ ...RESEND, EMAIL_DOMAIN: "payleor.com>" });

    await expect(mailer.send(message)).rejects.toThrow(/EMAIL_DOMAIN/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("configuredTransports", () => {
  it("includes Resend only when its key is set", () => {
    const names = (config: MailerConfig) => configuredTransports(config).map((transport) => transport.name);

    expect(names(RESEND)).toEqual(["resend"]);
    expect(names({ ...DOMAIN, RESEND_API_KEY: "" })).toEqual([]);
    expect(names(DOMAIN)).toEqual([]);
  });
});

describe("createMailer without a transport", () => {
  it("builds, then rejects every send with EmailNotConfiguredError", async () => {
    const fetchMock = stubFetch();
    const mailer = createMailer(DOMAIN);

    await expect(mailer.send(message)).rejects.toBeInstanceOf(EmailNotConfiguredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("mailerWithTransports", () => {
  function transport(name: string, outcome: "ok" | "fail", calls: string[]): Transport {
    return {
      name,
      async send(email) {
        calls.push(`${name}:${email.from.email}:${email.tags.map((tag) => `${tag.name}=${tag.value}`).join(",")}`);
        if (outcome === "fail") throw new Error(`${name} down`);
      },
    };
  }

  it("falls back to the next transport and stops at the first that succeeds", async () => {
    const calls: string[] = [];
    const mailer = mailerWithTransports(DOMAIN, [
      transport("first", "fail", calls),
      transport("second", "ok", calls),
      transport("third", "ok", calls),
    ]);

    await mailer.send(message);

    expect(calls).toEqual([
      "first:accounts@payleor.com:sender=accounts,kind=verification",
      "second:accounts@payleor.com:sender=accounts,kind=verification",
    ]);
  });

  it("rejects with the single failure when only one transport is configured", async () => {
    const mailer = mailerWithTransports(DOMAIN, [transport("first", "fail", [])]);

    await expect(mailer.send(message)).rejects.toThrow("first down");
  });

  it("rejects with every failure when all transports fail", async () => {
    const mailer = mailerWithTransports(DOMAIN, [transport("first", "fail", []), transport("second", "fail", [])]);

    const error = await mailer.send(message).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect((error as EmailDeliveryError).failures.map((failure) => failure.transport)).toEqual(["first", "second"]);
  });
});

describe("EmailDeliveryError", () => {
  it("lists the transports that failed", () => {
    const error = new EmailDeliveryError([
      { transport: "first", error: new Error("401") },
      { transport: "second", error: new Error("timeout") },
    ]);

    expect(error.name).toBe("EmailDeliveryError");
    expect(error.message).toContain("first, second");
    expect(error.failures).toHaveLength(2);
  });
});
