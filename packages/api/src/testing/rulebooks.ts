import type { Database } from "@jendal-workspace/db";
import { ensurePublishedRulebook } from "@jendal-workspace/db/repositories/operating-model";
import { seedServicesTeamMember, seedServicesTeamWithAdmin } from "@jendal-workspace/db/testing/db";

import { acceptMemberRulebook } from "../use-cases/rulebooks";

export async function acceptCurrentMemberAgreement(db: Database, teamId: string, userId: string): Promise<void> {
  const published = await ensurePublishedRulebook(db, teamId);
  await acceptMemberRulebook(db, { teamId, userId, termsAccepted: true, acceptedRulebookId: published.id });
}

export async function seedServicesTeamWithAgreedAdmin(...args: Parameters<typeof seedServicesTeamWithAdmin>) {
  const fixture = await seedServicesTeamWithAdmin(...args);
  await acceptCurrentMemberAgreement(args[0], fixture.teamId, fixture.userId);
  return fixture;
}

export async function seedAgreedServicesTeamMember(...args: Parameters<typeof seedServicesTeamMember>) {
  const userId = await seedServicesTeamMember(...args);
  await acceptCurrentMemberAgreement(args[0], args[1].teamId, userId);
  return userId;
}
