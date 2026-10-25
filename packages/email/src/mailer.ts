import type { SenderAddress, SenderKey } from "./senders";

export type EmailDelivery = {
  from: SenderAddress;
  replyTo: string;
  tags: { name: "sender" | "kind"; value: string }[];
};

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
  // Resolve configuration before persisting a message for idempotent delivery.
  delivery?: EmailDelivery;
}

export interface Mailer {
  prepare?(message: EmailMessage): EmailMessage;
  send(message: EmailMessage, options?: EmailSendOptions): Promise<EmailReceipt | void>;
}

export type EmailSendOptions = { idempotencyKey?: string };
export type EmailReceipt = { providerMessageId?: string };
