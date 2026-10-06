import { hasStoreWideRole } from "@jendal-workspace/core";
import { listOrganizationsWithStores } from "@jendal-workspace/db/repositories/stores";
import { TRPCError } from "@trpc/server";
import { APIError } from "better-auth/api";

import type { Context } from "./context";

// Store and services team creation share the rule (services spec §3): the first organization where the
// user is owner or admin, else a new organization named after the team.
export async function organizationForNewTeam(
  ctx: Context & { session: NonNullable<Context["session"]> },
  name: string,
): Promise<string> {
  const organizations = await listOrganizationsWithStores(ctx.db, ctx.session.user.id);
  const existing = organizations.find((o) => hasStoreWideRole(o.role))?.organization.id;
  if (existing) return existing;
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
