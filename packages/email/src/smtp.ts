import { createEmailClient } from "@opencoredev/email-sdk";
import { smtp } from "@opencoredev/email-sdk/smtp";

import type { Mailer } from "./mailer";

export type SmtpConfig = {
  SMTP_HOST: string;
  SMTP_PORT: string;
  SMTP_USER: string;
  SMTP_PASS: string;
  EMAIL_FROM: string;
};

// Port 587 with STARTTLS works inside workerd; port 465 (implicit TLS) failed there (spec §5.2).
export function createSmtpMailer(config: SmtpConfig): Mailer {
  const port = Number(config.SMTP_PORT || "587");
  const client = createEmailClient({
    adapters: [
      smtp({
        host: config.SMTP_HOST,
        port,
        secure: port === 465,
        auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
      }),
    ],
    telemetry: false,
  });
  return {
    async send(message) {
      await client.send({ from: config.EMAIL_FROM, ...message });
    },
  };
}
