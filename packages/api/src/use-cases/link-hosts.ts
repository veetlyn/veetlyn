import type { Database } from "@jendal-workspace/db";
import { team } from "@jendal-workspace/db/schema/organization";
import { payment, project } from "@jendal-workspace/db/schema/projects";
import { eq } from "drizzle-orm";

import { verifyClientLink, verifyPayLink } from "../client-links";

export type LinkKind = "client" | "pay";

// The team whose site serves a client or pay link (run C design §7): the page answers only on that team's own
// host. A forged token names no team. Whether the link still opens the project is the page's own check.
export async function teamSlugForLink(
  db: Database,
  secret: string,
  link: { kind: LinkKind; token: string },
): Promise<string | null> {
  if (link.kind === "client") {
    const claim = await verifyClientLink(secret, link.token);
    if (!claim) return null;
    const [row] = await db
      .select({ slug: team.slug })
      .from(project)
      .innerJoin(team, eq(team.id, project.teamId))
      .where(eq(project.id, claim.projectId))
      .limit(1);
    return row?.slug ?? null;
  }
  const paymentId = await verifyPayLink(secret, link.token);
  if (!paymentId) return null;
  const [row] = await db
    .select({ slug: team.slug })
    .from(payment)
    .innerJoin(team, eq(team.id, payment.teamId))
    .where(eq(payment.id, paymentId))
    .limit(1);
  return row?.slug ?? null;
}

// Where a team's client and pay pages live: its own seller site.
export function clientPageUrl(storeOrigin: (slug: string) => string, teamSlug: string, path: string): string {
  return `${storeOrigin(teamSlug)}${path}`;
}
