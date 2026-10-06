import type { PayoutMode, QuotingMode, ServicesTeamRole, TeamProduct } from "@jendal-workspace/core";

export const PRODUCT_LABELS: Record<TeamProduct, string> = {
  store: "Store",
  services: "Services team",
};

export const SERVICES_TEAM_ROLE_LABELS: Record<ServicesTeamRole, string> = {
  admin: "Admin",
  manager: "Manager",
  freelancer: "Freelancer",
};

export const SERVICES_TEAM_ROLE_DESCRIPTIONS: Record<ServicesTeamRole, string> = {
  admin: "Manages members, rates and payouts.",
  manager: "Quotes and confirms, and sees everything.",
  freelancer: "Works on their assignments.",
};

export const QUOTING_MODE_LABELS: Record<QuotingMode, string> = {
  open: "Open quotes",
  assigned: "Assigned quotes",
  team: "Team quotes",
};

export const PAYOUT_MODE_LABELS: Record<PayoutMode, string> = {
  manual: "Manual payouts",
  rules: "Rule-based payouts",
  automatic: "Automatic payouts",
};
