import { hasStoreWideRole } from "@jendal-workspace/core";
import { organizationsWithSoloSellers } from "@jendal-workspace/db/repositories/services-teams";
import { listOrganizationsWithStores } from "@jendal-workspace/db/repositories/stores";
import { TRPCError } from "@trpc/server";
import { APIError } from "better-auth/api";

import type { Context } from "./context";

// Store and services team creation share the rule (services spec §3): the first organization where the
// user is owner or admin and no solo seller lives, else a new organization named after the team.
// A solo seller always gets a new organization, so its owner is its only member (sellers design §3.1).
export async function organizationForNewTeam(
  ctx: Context & { session: NonNullable<Context["session"]> },
  name: string,
  options: { solo?: boolean } = {},
): Promise<string> {
  if (!options.solo) {
    const organizations = await listOrganizationsWithStores(ctx.db, ctx.session.user.id);
    const candidates = organizations.filter((o) => hasStoreWideRole(o.role)).map((o) => o.organization.id);
    const soloHomes = await organizationsWithSoloSellers(ctx.db, candidates);
    const existing = candidates.find((id) => !soloHomes.has(id));
    if (existing) return existing;
  }
  // The organization slug is never shown; stores and teams carry the public addresses.
  const created = await ctx.auth.api.createOrganization({
    body: { name, slug: `org-${crypto.randomUUID()}` },
    headers: ctx.headers,
  });
  if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create the organization." });
  return created.id;
}

export function toTRPCError(error: unknown): unknown {
  if (!(error instanceof APIError)) return error;
  const code = error.status === "CONFLICT" ? "CONFLICT" : error.status === "FORBIDDEN" ? "FORBIDDEN" : "BAD_REQUEST";
  return new TRPCError({ code, message: error.body?.message ?? error.message, cause: error });
}
