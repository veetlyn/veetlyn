import { createEmailClient } from "@opencoredev/email-sdk";
import { resend } from "@opencoredev/email-sdk/resend";

import type { Mailer } from "./mailer";
import { type SenderAddress, senderAddress } from "./senders";

export type MailerConfig = {
  RESEND_API_KEY?: string;
  EMAIL_DOMAIN: string;
  PLATFORM_NAME: string;
  EMAIL_REPLY_TO: string;
};

export type OutgoingTag = { name: "sender" | "kind"; value: string };

export type OutgoingEmail = {
  from: SenderAddress;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
  tags: OutgoingTag[];
};

export type Transport = {
  name: string;
  send(email: OutgoingEmail): Promise<void>;
};

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("No email transport is configured: set RESEND_API_KEY.");
    this.name = "EmailNotConfiguredError";
  }
}

export class EmailDeliveryError extends Error {
  readonly failures: ReadonlyArray<{ transport: string; error: unknown }>;

  constructor(failures: ReadonlyArray<{ transport: string; error: unknown }>) {
    super(`Every email transport failed (${failures.map((failure) => failure.transport).join(", ")}).`, {
      cause: failures.at(-1)?.error,
    });
    this.name = "EmailDeliveryError";
    this.failures = failures;
  }
}

// Resend rejects tag values with anything but ASCII letters, digits, underscores and dashes, up to 256 characters.
function tagValue(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256);
}

function resendTransport(apiKey: string): Transport {
  const client = createEmailClient({ adapters: [resend({ apiKey })], telemetry: false });
  return {
    name: "resend",
    async send(email) {
      await client.send(email);
    },
  };
}

export function mailerWithTransports(
  config: Pick<MailerConfig, "EMAIL_DOMAIN" | "EMAIL_REPLY_TO" | "PLATFORM_NAME">,
  transports: readonly Transport[],
): Mailer {
  return {
    async send(message) {
      if (transports.length === 0) throw new EmailNotConfiguredError();
      const tags: OutgoingTag[] = [{ name: "sender", value: message.sender }];
      if (message.tag) tags.push({ name: "kind", value: tagValue(message.tag) });
      const email: OutgoingEmail = {
        from: senderAddress(message.sender, config.EMAIL_DOMAIN, config.PLATFORM_NAME, message.onBehalfOf),
        to: message.to,
        replyTo: message.replyTo ?? config.EMAIL_REPLY_TO,
        subject: message.subject,
        text: message.text,
        html: message.html,
        tags,
      };
      // A transport that fails after the provider accepted the message would make the next one send a duplicate;
      // for account emails a duplicate is better than none.
      const failures: Array<{ transport: string; error: unknown }> = [];
      for (const transport of transports) {
        try {
          await transport.send(email);
          return;
        } catch (error) {
          failures.push({ transport: transport.name, error });
        }
      }
      throw failures.length === 1 ? failures[0]?.error : new EmailDeliveryError(failures);
    },
  };
}

// Transports in the order they are tried; Cloudflare Email Service is meant to join here and replace Resend.
export function configuredTransports(config: MailerConfig): Transport[] {
  const transports: Transport[] = [];
  if (config.RESEND_API_KEY) transports.push(resendTransport(config.RESEND_API_KEY));
  return transports;
}

// Never throws: auth is built per request, so a missing transport must fail the send, not every auth endpoint.
export function createMailer(config: MailerConfig): Mailer {
  return mailerWithTransports(config, configuredTransports(config));
}
