import {
  isStorePublic,
  validateQuoteRequest,
  QUOTE_REQUEST_LIMITS,
  type QuoteRequestAnswer,
} from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import {
  attachContact,
  countOpenRequestsForEmail,
  lockClientIdentity,
  matchOrCreateContact,
} from "@jendal-workspace/db/repositories/contacts";
import { hitRequestLimit } from "@jendal-workspace/db/repositories/request-limits";
import { findServicesOffering } from "@jendal-workspace/db/repositories/services-catalog";
import { findServicesTeamBySlug, getServicesTeamSettings } from "@jendal-workspace/db/repositories/services-teams";
import { team as teamTable } from "@jendal-workspace/db/schema/organization";
import { project } from "@jendal-workspace/db/schema/projects";
import { quoteRequestLinkEmail, quoteRequestNoticeEmail } from "@jendal-workspace/email";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import { ActionError } from "../actions/errors";
import { type LinkSecretSource, linkSecret } from "../client-links";
import type { EmailServices } from "../context";
import { primaryClientPath } from "./clients";
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
// limit is spent only by valid requests, so typos never lock a client out.
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
    await lockClientIdentity(tx, { teamId: team.id, key: email });
    const open = await countOpenRequestsForEmail(tx, { teamId: team.id, email });
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
    const clientName = input.name.trim();
    const contactId = await matchOrCreateContact(tx, {
      teamId: team.id,
      email,
      discordId: null,
      name: clientName,
      source: "request",
    });
    // The link is emailed to this address right after the transaction.
    await attachContact(tx, { projectId: row.id, contactId, isPrimary: true, addedById: null, linkEmail: email });
    await uow.apply({
      project: row,
      set: {},
      events: [
        {
          type: "project.created",
          data: { projectId: row.id, title: row.title, contactIds: [contactId], clientName, channelId: null },
        },
      ],
    });
    return { projectId: row.id };
  });
  return { ...result, teamName: team.name, serviceName, supportEmail: contact?.supportEmail ?? null };
}

// The public quote request form (sellers design §4.2): no account, a honeypot, and per-IP and
// per-email limits before a project row and the two emails. The honeypot check runs first so bots
// never touch the limit budget; the per-email limit lives in requestQuote, after validation.
export async function createQuoteRequest(
  deps: { db: Database; auth: LinkSecretSource; email?: EmailServices },
  request: { ip: string | null },
  input: QuoteRequestInput & { website: string },
): Promise<{ ok: true }> {
  const { db } = deps;
  if (input.website.trim() !== "") return { ok: true as const };
  if (request.ip) {
    const allowed = await hitRequestLimit(db, { key: `quote-request:ip:${request.ip}`, windowMs: HOUR_MS, max: 20 });
    if (!allowed) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many requests. Wait a little and try again." });
    }
  }
  const emailServices = deps.email;
  if (!emailServices) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Requests are not available right now." });
  }

  const { projectId, teamName, serviceName, supportEmail } = await requestQuote(db, input);
  const clientUrl = `${emailServices.siteOrigin}${await primaryClientPath(db, linkSecret(deps.auth), projectId)}`;
  const linkContent = quoteRequestLinkEmail({ clientName: input.name.trim(), teamName, url: clientUrl });
  // The client's mail proves the address, so its failure is the request's failure. The caller gets a
  // generic message; the provider's error text stays server-side.
  try {
    await emailServices.mailer.send({
      sender: "invoices",
      onBehalfOf: teamName,
      replyTo: supportEmail ?? undefined,
      tag: "quote-request",
      to: input.email.trim().toLowerCase(),
      ...linkContent,
    });
  } catch (error) {
    await emailServices.onError?.(error, { kind: "quote-request", to: input.email.trim().toLowerCase() });
    throw new ActionError("internal", "We could not send the email. Try again in a moment.", { expose: true });
  }
  if (supportEmail) {
    const notice = quoteRequestNoticeEmail({
      teamName,
      clientName: input.name.trim(),
      clientEmail: input.email.trim().toLowerCase(),
      serviceName,
      description: input.description.trim(),
      // Trimmed, as stored on the project.
      answers: input.answers.map(({ question, answer }) => ({ question: question.trim(), answer: answer.trim() })),
      url: `${emailServices.adminOrigin}/${input.slug}/projects/${projectId}`,
    });
    const send = emailServices.mailer
      .send({ sender: "invoices", onBehalfOf: teamName, tag: "quote-request-notice", to: supportEmail, ...notice })
      .catch((cause: unknown) => emailServices.onError?.(cause, { kind: "quote-request-notice", to: supportEmail }));
    if (emailServices.waitUntil) emailServices.waitUntil(send);
    else await send;
  }
  return { ok: true as const };
}
