import type { StoreStatus } from "../tenancy/store";

export const SERVICES_TEAM_ROLES = ["admin", "manager", "freelancer"] as const;
export type ServicesTeamRole = (typeof SERVICES_TEAM_ROLES)[number];

export const CURRENCIES = ["USD", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const QUOTING_MODES = ["open", "assigned", "team"] as const;
export type QuotingMode = (typeof QUOTING_MODES)[number];

// A services team is a Better Auth team with product "services"; `id` is the team ID.
export type ServicesTeamRecord = {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  status: StoreStatus;
  paypalMerchantId: string | null;
};

export type ServicesTeamSettings = {
  teamId: string;
  // Sellers design §3.1: a solo seller is a team of one; its owner does the work and keeps the whole price.
  solo: boolean;
  // The team kind that seeds its rulebook preset (operating model design §3).
  kind: "solo" | "agency" | "collective";
  // Sellers design §3.2: the store section of the seller page. Run 4 fills it; the column exists now.
  storeEnabled: boolean;
  // Sellers design §3.2: up to MAX_BIO_CHARS characters, shown on the seller page.
  bio: string;
  currency: Currency;
  // Basis points: 1500 = 15%.
  teamCutBps: number;
  managementFeeBps: number;
  // The manager cut published with the rulebook; synced so settings and rules never disagree.
  managerCutBps: number;
  quotingMode: QuotingMode;
  // Null until an admin saves the settings once; the setup checklist reads it.
  settingsSavedAt: Date | null;
  // S2: the guild this team is linked to; unique across teams (one server per team, one team per server).
  discordGuildId: string | null;
};

export type ServicesTeamSettingsInput = Pick<
  ServicesTeamSettings,
  "currency" | "teamCutBps" | "managementFeeBps" | "quotingMode"
>;

export const MAX_RATE_BPS = 10_000;

export const MAX_BIO_CHARS = 280;

// Must match the column defaults of services_team_settings in packages/db.
export function defaultServicesTeamSettings(teamId: string): ServicesTeamSettings {
  return {
    teamId,
    solo: false,
    kind: "agency",
    storeEnabled: false,
    bio: "",
    currency: "USD",
    teamCutBps: 1500,
    managementFeeBps: 1000,
    managerCutBps: 0,
    quotingMode: "assigned",
    settingsSavedAt: null,
    discordGuildId: null,
  };
}

// Sellers design §3.1: a solo seller keeps the whole price, so completion owes no earnings and no payout runs.
export const SOLO_TEAM_CUT_BPS = 10_000;
export const SOLO_MANAGEMENT_FEE_BPS = 0;

export function soloServicesTeamSettings(teamId: string): ServicesTeamSettings {
  return {
    ...defaultServicesTeamSettings(teamId),
    solo: true,
    teamCutBps: SOLO_TEAM_CUT_BPS,
    managementFeeBps: SOLO_MANAGEMENT_FEE_BPS,
  };
}

export function bioProblem(bio: string): string | null {
  return bio.trim().length > MAX_BIO_CHARS ? `Keep your bio under ${MAX_BIO_CHARS} characters.` : null;
}

function oneOf<T extends string>(values: readonly T[], value: string | null | undefined): value is T {
  return values.some((v) => v === value);
}

export function isServicesTeamRole(value: string): value is ServicesTeamRole {
  return oneOf(SERVICES_TEAM_ROLES, value);
}

export function isCurrency(value: string): value is Currency {
  return oneOf(CURRENCIES, value);
}

export function isQuotingMode(value: string): value is QuotingMode {
  return oneOf(QUOTING_MODES, value);
}
