export const SERVICES_TEAM_ROLES = ["admin", "manager", "freelancer"] as const;
export type ServicesTeamRole = (typeof SERVICES_TEAM_ROLES)[number];

export const CURRENCIES = ["USD", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const QUOTING_MODES = ["open", "assigned", "team"] as const;
export type QuotingMode = (typeof QUOTING_MODES)[number];

export const PAYOUT_MODES = ["manual", "rules", "automatic"] as const;
export type PayoutMode = (typeof PAYOUT_MODES)[number];

// A services team is a Better Auth team with product "services"; `id` is the team ID.
export type ServicesTeamRecord = {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  paypalMerchantId: string | null;
};

export type ServicesTeamSettings = {
  teamId: string;
  currency: Currency;
  // Basis points: 1500 = 15%.
  teamCutBps: number;
  managementFeeBps: number;
  quotingMode: QuotingMode;
  payoutMode: PayoutMode;
  // Null until an admin saves the settings once; the setup checklist reads it.
  settingsSavedAt: Date | null;
  // S2: the guild this team is linked to; unique across teams (one server per team, one team per server).
  discordGuildId: string | null;
};

export type ServicesTeamSettingsInput = Pick<
  ServicesTeamSettings,
  "currency" | "teamCutBps" | "managementFeeBps" | "quotingMode" | "payoutMode"
>;

export const MAX_RATE_BPS = 10_000;

// Must match the column defaults of services_team_settings in packages/db.
export function defaultServicesTeamSettings(teamId: string): ServicesTeamSettings {
  return {
    teamId,
    currency: "USD",
    teamCutBps: 1500,
    managementFeeBps: 1000,
    quotingMode: "assigned",
    payoutMode: "manual",
    settingsSavedAt: null,
    discordGuildId: null,
  };
}

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return values.some((v) => v === value);
}

export function isServicesTeamRole(value: unknown): value is ServicesTeamRole {
  return oneOf(SERVICES_TEAM_ROLES, value);
}

export function isCurrency(value: unknown): value is Currency {
  return oneOf(CURRENCIES, value);
}

export function isQuotingMode(value: unknown): value is QuotingMode {
  return oneOf(QUOTING_MODES, value);
}

export function isPayoutMode(value: unknown): value is PayoutMode {
  return oneOf(PAYOUT_MODES, value);
}
