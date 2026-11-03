import { hasStoreWideRole } from "@jendal-workspace/core";
import { emptyOwnedWorkspace, workspaceRoleFor } from "@jendal-workspace/db/repositories/services-teams";
import { TRPCError } from "@trpc/server";
import { APIError } from "better-auth/api";

import type { Context } from "./context";

// A workspace is like a Slack workspace: its own members, trial and subscription (billing design §2). Creating a
// seller makes a new workspace unless the caller names one of theirs to add it to; the plan's limits then apply in
// the createTeam hook. A solo seller always gets a workspace of its own, so its owner is its only member.
export async function organizationForNewTeam(
  ctx: Context & { session: NonNullable<Context["session"]> },
  name: string,
  options: { solo?: boolean; organizationId?: string } = {},
): Promise<string> {
  if (options.organizationId) {
    if (options.solo) throw new TRPCError({ code: "BAD_REQUEST", message: "A solo seller gets a workspace of its own." });
    const role = await workspaceRoleFor(ctx.db, options.organizationId, ctx.session.user.id);
    // Someone outside the workspace gets the same answer as a missing one.
    if (!role) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found." });
    if (!hasStoreWideRole(role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only workspace owners and admins can add sellers." });
    }
    return options.organizationId;
  }
  const empty = await emptyOwnedWorkspace(ctx.db, ctx.session.user.id);
  if (empty) return empty;
  // The organization slug is never shown; stores and teams carry the public addresses.
  const created = await ctx.auth.api.createOrganization({
    body: { name, slug: `org-${crypto.randomUUID()}` },
    headers: ctx.headers,
  });
  if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create the organization." });
  return created.id;
}

export function toTRPCError(cause: unknown): Error {
  if (!(cause instanceof APIError)) return cause instanceof Error ? cause : new Error(String(cause), { cause });
  const code = cause.status === "CONFLICT" ? "CONFLICT" : cause.status === "FORBIDDEN" ? "FORBIDDEN" : "BAD_REQUEST";
  return new TRPCError({ code, message: cause.body?.message ?? cause.message, cause });
}
