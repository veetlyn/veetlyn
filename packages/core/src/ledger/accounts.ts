// Services spec §6.2. Every account belongs to one team and one currency; the key names it within the team.
export type LedgerAccountKey =
  | `client_held:${string}`
  | "team_revenue"
  | `owed:${string}:available`
  | `owed:${string}:reserved`
  | `paid_out:${string}`
  | "client_refunds"
  | "paypal_clearing"
  | "paypal_fees"
  | "platform_fees";

export type LedgerAccountKind =
  | "client_held"
  | "team_revenue"
  | "owed_available"
  | "owed_reserved"
  | "paid_out"
  | "client_refunds"
  | "paypal_clearing"
  | "paypal_fees"
  | "platform_fees";

// IDs are embedded in keys, so a ":" would make a key ambiguous.
function keyPart(id: string): string {
  if (id.length === 0 || id.includes(":")) throw new Error(`Invalid ledger account id: ${JSON.stringify(id)}`);
  return id;
}

export const ledgerAccounts = {
  clientHeld: (projectId: string) => `client_held:${keyPart(projectId)}` as const,
  teamRevenue: "team_revenue",
  owedAvailable: (freelancerId: string) => `owed:${keyPart(freelancerId)}:available` as const,
  owedReserved: (freelancerId: string) => `owed:${keyPart(freelancerId)}:reserved` as const,
  paidOut: (freelancerId: string) => `paid_out:${keyPart(freelancerId)}` as const,
  clientRefunds: "client_refunds",
  paypalClearing: "paypal_clearing",
  paypalFees: "paypal_fees",
  platformFees: "platform_fees",
} as const;

export function ledgerAccountKind(key: string): LedgerAccountKind | null {
  if (
    key === "team_revenue" ||
    key === "paypal_fees" ||
    key === "platform_fees" ||
    key === "client_refunds" ||
    key === "paypal_clearing"
  ) {
    return key;
  }
  const parts = key.split(":");
  if (parts.length === 2 && parts[1]) {
    if (parts[0] === "client_held") return "client_held";
    if (parts[0] === "paid_out") return "paid_out";
  }
  if (parts.length === 3 && parts[0] === "owed" && parts[1]) {
    if (parts[2] === "available") return "owed_available";
    if (parts[2] === "reserved") return "owed_reserved";
  }
  return null;
}

export function isLedgerAccountKey(key: string): key is LedgerAccountKey {
  return ledgerAccountKind(key) !== null;
}

// Services spec §6.1 point 3: earnings owed (available and reserved) never go below zero. Client money held,
// money paid out and refunds in flight cannot be negative either. team_revenue may go negative after a
// chargeback the team absorbs; paypal_clearing is a counterpart and is negative by design.
const NON_NEGATIVE: ReadonlySet<LedgerAccountKind> = new Set([
  "client_held",
  "owed_available",
  "owed_reserved",
  "paid_out",
  "client_refunds",
]);

export function breaksLedgerInvariant(key: LedgerAccountKey, balanceMinor: number): boolean {
  const kind = ledgerAccountKind(key);
  return kind !== null && NON_NEGATIVE.has(kind) && balanceMinor < 0;
}
