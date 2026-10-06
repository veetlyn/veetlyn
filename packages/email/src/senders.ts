export type SenderKey = "accounts" | "stores" | "invoices" | "payouts" | "disputes" | "billing";

export type SenderAddress = { email: string; name: string };

// Each purpose has its own address so recipients can filter and the domain's reputation is tracked per stream.
const SENDERS: Record<SenderKey, { localPart: string; name: string }> = {
  // Sign-in, verification, password reset, invites and security notices.
  accounts: { localPart: "accounts", name: "Payleor" },
  // Mail to store buyers, usually as "{Store} via Payleor".
  stores: { localPart: "stores", name: "Payleor Stores" },
  // Quotes, payment requests and receipts to services-team clients, usually as "{Team} via Payleor".
  invoices: { localPart: "invoices", name: "Payleor Invoices" },
  // Mail to freelancers about their payouts.
  payouts: { localPart: "payouts", name: "Payleor Payouts" },
  // Cases and PayPal disputes.
  disputes: { localPart: "disputes", name: "Payleor Disputes" },
  // Payleor's own subscription billing.
  billing: { localPart: "billing", name: "Payleor Billing" },
};

const MAX_PARTY_NAME_LENGTH = 64;

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// Control and format characters (CR/LF, NUL, bidi overrides) could inject headers or disguise the name; the
// punctuation is what RFC 5322 gives meaning to in a display name, so a party could otherwise smuggle in an address.
const UNSAFE_NAME_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}"<>@,;:\\()[\]]/gu;

function cleanPartyName(value: string): string {
  const collapsed = value.replace(UNSAFE_NAME_CHARACTERS, " ").replace(/\s+/g, " ").trim();
  return Array.from(collapsed).slice(0, MAX_PARTY_NAME_LENGTH).join("").trim();
}

export function senderAddress(key: SenderKey, domain: string, onBehalfOf?: string): SenderAddress {
  const host = domain.trim().toLowerCase();
  if (!HOSTNAME.test(host)) {
    throw new Error(`EMAIL_DOMAIN must be a hostname such as payleor.com; got ${JSON.stringify(domain)}.`);
  }
  const sender = SENDERS[key];
  const party = onBehalfOf ? cleanPartyName(onBehalfOf) : "";
  return { email: `${sender.localPart}@${host}`, name: party ? `${party} via Payleor` : sender.name };
}
