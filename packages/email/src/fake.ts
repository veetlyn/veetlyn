import type { EmailMessage, Mailer } from "./mailer";

export type FakeMailer = Mailer & { readonly sent: EmailMessage[] };

export function createFakeMailer(): FakeMailer {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}
