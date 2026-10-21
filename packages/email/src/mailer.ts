import type { SenderKey } from "./senders";

export interface EmailMessage {
  sender: SenderKey;
  // The store or team the message is sent for; shown as "{onBehalfOf} via {platform name}".
  onBehalfOf?: string;
  // Defaults to EMAIL_REPLY_TO.
  replyTo?: string;
  // A short purpose label for the provider's analytics, e.g. "verification"; characters other than ASCII letters,
  // digits, "_" and "-" become "_".
  tag?: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}
