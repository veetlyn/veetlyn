import type { QuotingMode, ServicesTeamRole, TeamProduct } from "@jendal-workspace/core";

export const PRODUCT_LABELS = {
  store: "Store",
  services: "Services team",
} satisfies Record<TeamProduct, string>;

export const SERVICES_TEAM_ROLE_LABELS = {
  admin: "Admin",
  manager: "Manager",
  freelancer: "Freelancer",
} satisfies Record<ServicesTeamRole, string>;

export const SERVICES_TEAM_ROLE_DESCRIPTIONS = {
  admin: "Manages members, rates and payouts.",
  manager: "Quotes and confirms, and sees everything.",
  freelancer: "Works on their assignments.",
} satisfies Record<ServicesTeamRole, string>;

export const QUOTING_MODE_LABELS = {
  open: "Open quotes",
  assigned: "Assigned quotes",
  team: "Team quotes",
} satisfies Record<QuotingMode, string>;

export const QUOTING_MODE_DESCRIPTIONS = {
  open: "Any freelancer quotes their own work; admins and managers can quote for a freelancer they name.",
  assigned: "Only the freelancer assigned to the project sends its quote.",
  team: "Admins and managers quote, naming the freelancer who will do the work.",
} satisfies Record<QuotingMode, string>;
