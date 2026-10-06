// Stores and services teams are both Better Auth teams, told apart by team.product (services spec §3).
export const TEAM_PRODUCTS = ["store", "services"] as const;

export type TeamProduct = (typeof TEAM_PRODUCTS)[number];

export function isTeamProduct(value: unknown): value is TeamProduct {
  return TEAM_PRODUCTS.some((product) => product === value);
}
