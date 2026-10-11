import {
  isStorePublic,
  validateQuoteRequest,
  QUOTE_REQUEST_LIMITS,
  type QuoteRequestAnswer,
} from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import { countOpenWebRequests } from "@jendal-workspace/db/repositories/projects";
import { hitRequestLimit } from "@jendal-workspace/db/repositories/request-limits";
import { findServicesOffering } from "@jendal-workspace/db/repositories/services-catalog";
import { findServicesTeamBySlug, getServicesTeamSettings } from "@jendal-workspace/db/repositories/services-teams";
import { team as teamTable } from "@jendal-workspace/db/schema/organization";
import { project } from "@jendal-workspace/db/schema/projects";
import { eq, sql } from "drizzle-orm";

import { fail, runProjectTransaction } from "./projects";

export type QuoteRequestInput = {
  slug: string;
  offeringId: string | null;
  name: string;
  email: string;
  description: string;
  answers: QuoteRequestAnswer[];
};

const HOUR_MS = 3_600_000;

// Sellers design §4.2: a public request becomes a project in quoting, source "web". The per-email
// limit is spent only by requests that would otherwise go through, so typos never lock a client out.
export async function requestQuote(
  db: Database,
  input: QuoteRequestInput,
): Promise<{ projectId: string; teamName: string; serviceName: string; supportEmail: string | null }> {
  const team = await findServicesTeamBySlug(db, input.slug);
  if (!team || !isStorePublic({ ...team, product: "services" })) fail("NOT_FOUND", "Seller not found.");
  const email = input.email.trim().toLowerCase();
  const problems = validateQuoteRequest({
    name: input.name,
    email,
    description: input.description,
    answers: input.answers,
  });
  if (problems.length > 0) fail("BAD_REQUEST", problems[0]!);
  let serviceName = "Something else";
  if (input.offeringId) {
    const offering = await findServicesOffering(db, { id: input.offeringId, teamId: team.id });
    if (!offering?.active) fail("BAD_REQUEST", "That service is not on this seller's list.");
    serviceName = offering.name;
  }
  const emailAllowed = await hitRequestLimit(db, {
    key: `quote-request:email:${input.slug}:${email}`,
    windowMs: HOUR_MS,
    max: 5,
  });
  if (!emailAllowed) fail("TOO_MANY_REQUESTS", "Too many requests. Wait a little and try again.");
  const settings = await getServicesTeamSettings(db, team.id);
  if (!settings) fail("NOT_FOUND", "Services team settings not found.");
  const [contact] = await db
    .select({ supportEmail: teamTable.supportEmail })
    .from(teamTable)
    .where(eq(teamTable.id, team.id))
    .limit(1);

  const result = await runProjectTransaction(db, async (tx, uow) => {
    // Serialises requests per (team, email) so two at once cannot both pass the open-request count.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${team.id} || ':' || ${email}))`);
    const open = await countOpenWebRequests(tx, { teamId: team.id, clientEmail: email });
    if (open >= QUOTE_REQUEST_LIMITS.openPerEmailPerTeam) {
      fail(
        "BAD_REQUEST",
        `You already have ${QUOTE_REQUEST_LIMITS.openPerEmailPerTeam} open requests with this team. Wait for an answer before sending another.`,
      );
    }
    const [row] = await tx
      .insert(project)
      .values({
        teamId: team.id,
        title: serviceName,
        brief: input.description.trim(),
        clientEmail: email,
        clientName: input.name.trim(),
        requestAnswers: input.answers.map(({ question, answer }) => ({
          question: question.trim(),
          answer: answer.trim(),
        })),
        offeringId: input.offeringId,
        source: "web",
        currency: settings.currency,
        managementFeeBps: settings.managementFeeBps,
        teamCutBps: settings.teamCutBps,
      })
      .returning();
    if (!row) throw new Error("Insert into project returned no row");
    await uow.apply({
      project: row,
      set: {},
      events: [
        {
          type: "project.created",
          data: { projectId: row.id, title: row.title, clientEmail: email, clientDiscordId: null, channelId: null },
        },
      ],
    });
    return { projectId: row.id };
  });
  return { ...result, teamName: team.name, serviceName, supportEmail: contact?.supportEmail ?? null };
}
