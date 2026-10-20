import type { Database } from "@jendal-workspace/db";
import { listClientProjectsForUser } from "@jendal-workspace/db/repositories/contacts";
import { servicesTeamRoleFor } from "@jendal-workspace/db/repositories/services-teams";

import { type LinkSecretSource, linkSecret, signAccountClientLink } from "../client-links";
import type { EmailServices } from "../context";
import { clientPageUrl } from "./link-hosts";

const BRIEF_START = 140;

function briefStart(brief: string): string {
  const flat = brief.replace(/\s+/g, " ").trim();
  return flat.length > BRIEF_START ? `${flat.slice(0, BRIEF_START - 1)}…` : flat;
}

// The signed-in client's projects across teams (plugin design §7, the plugin's project list): a project of a
// team the person belongs to is never theirs as a client.
export async function listClientProjects(
  deps: { db: Database; auth: LinkSecretSource; email?: EmailServices },
  userId: string,
) {
  const rows = await listClientProjectsForUser(deps.db, userId);
  const memberOf = new Map<string, boolean>();
  for (const teamId of new Set(rows.map((r) => r.teamId))) {
    memberOf.set(teamId, (await servicesTeamRoleFor(deps.db, teamId, userId)) !== null);
  }
  const secret = linkSecret(deps.auth);
  const storeOrigin = deps.email?.storeOrigin;
  return Promise.all(
    rows
      .filter((row) => !memberOf.get(row.teamId))
      .map(async (row) => {
        const token = await signAccountClientLink(secret, {
          projectId: row.projectId,
          contactId: row.contactId,
          version: row.linkVersion,
        });
        return {
          id: row.projectId,
          title: row.title,
          briefStart: briefStart(row.brief),
          status: row.status,
          createdAt: row.createdAt,
          teamName: row.teamName,
          teamSlug: row.teamSlug,
          clientUrl: storeOrigin ? clientPageUrl(storeOrigin, row.teamSlug, `/c/${token}`) : null,
        };
      }),
  );
}
