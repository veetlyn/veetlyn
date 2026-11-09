import { formatMoney, isProjectStaff, money, quoteAuthor } from "@jendal-workspace/core";
import {
  claimArrivedRequests,
  countDraftsSince,
  findLatestOwnCallAt,
  listAgentCallEntries,
  releaseDraftCall,
  resumeDraftCall,
  startDraftCall,
  type CallPlace,
} from "@jendal-workspace/db/repositories/calls";
import { findProjectById, listProjectQuotes, listTeamProjects } from "@jendal-workspace/db/repositories/projects";
import { findServicesOffering } from "@jendal-workspace/db/repositories/services-catalog";
import { getServicesTeamSettings } from "@jendal-workspace/db/repositories/services-teams";

import type { RequestMeta } from "../actions/actors";
import type { ActionDeps } from "../actions/perform";
import { teamPeople } from "../use-cases/outbox-dispatcher";
import { placeOf, resolveNode, type ResolvedNode, type ResolvedSeller } from "./node";
import type { CallRuntime } from "./runtime";
import { startOfUtcDay } from "./turn";

type Deps = { actions: ActionDeps; request: RequestMeta; calls: CallRuntime };

// Only the seller's own catalogue goes into the directive; what the client wrote is read through project_get, where
// the system prompt already treats it as information and never as instructions.
async function draftDirective(deps: Deps, project: { id: string; teamId: string; offeringId: string | null; currency: Parameters<typeof money>[0] }, freelancerId: string) {
  const offering = project.offeringId ? await findServicesOffering(deps.actions.db, { id: project.offeringId, teamId: project.teamId }) : null;
  const range = offering
    ? `The service "${offering.name}" is listed at ${formatMoney(money(project.currency, offering.priceMinMinor))} to ${formatMoney(money(project.currency, offering.priceMaxMinor))}, delivered in ${offering.daysMin} to ${offering.daysMax} days. Stay in that range unless the brief clearly needs otherwise, and say so if it does.`
    : "This request names no listed service, so base the price on the brief and say what you assumed.";
  return [
    `A new client request is waiting for a quote (project id ${project.id}).`,
    `Read it with project_get, then call propose_quote_create once with line items, delivery days that answer the brief, and freelancerId ${freelancerId}.`,
    range,
    "In the card sentence, give the reason for this price in one or two plain sentences, naming what in the brief drove it.",
    "Then say in one short sentence what you prepared and anything the person should check. If the brief is too thin to price, propose no quote and say what is missing.",
  ].join("\n");
}

type Row = Awaited<ReturnType<typeof listTeamProjects>>[number];
type Settings = NonNullable<Awaited<ReturnType<typeof getServicesTeamSettings>>>;
type Drafted = "drafted" | "failed" | "exists" | "refused";

// Long enough for a turn to finish; an older claim with nothing written belongs to a turn that died.
const DRAFT_LEASE_MS = 5 * 60_000;
// Events older than this are left to Home: a person told about a day-old request may already have answered it.
const ARRIVAL_WINDOW_MS = 60 * 60_000;

async function claimDraft(deps: Deps, place: CallPlace & { userId: string; title: string }, now: Date) {
  const { db } = deps.actions;
  const earlier = await findLatestOwnCallAt(db, place);
  if (!earlier) return startDraftCall(db, { ...place, now });
  if ((await listAgentCallEntries(db, earlier.id)).length > 0) return null;
  return resumeDraftCall(db, { callId: earlier.id, now, startedBefore: new Date(now.getTime() - DRAFT_LEASE_MS) });
}

// One quote, as this person and only proposing. The quoting mode decides as it will on confirm: a draft this person
// could never send is worse than none.
async function draftQuote(deps: Deps, seller: ResolvedSeller, settings: Settings, userId: string, row: Row): Promise<Drafted> {
  if (seller.role.product !== "services" || seller.access.hideProjectFinances) return "refused";
  const { db } = deps.actions;
  if ((await listProjectQuotes(db, row.id)).length > 0) return "exists";
  const author = quoteAuthor({
    role: seller.role.role,
    actorId: userId,
    quotingMode: settings.quotingMode,
    assignedFreelancerId: row.assignedFreelancerId,
    // Unassigned work is drafted as the person preparing it; the card names them, and they can ask for someone else.
    freelancerId: row.assignedFreelancerId ?? userId,
    solo: settings.solo,
  });
  if (!author.ok) return "refused";
  const node = await resolveNode(deps, userId, { kind: "record", teamId: seller.id, record: { type: "project", id: row.id } });
  if (!node) return "refused";
  const place = { ...placeOf(node), userId, title: `Quote for ${row.title}`.slice(0, 80) };
  const call = await claimDraft(deps, place, deps.actions.now?.() ?? new Date());
  if (!call) return "exists";
  let drafted = false;
  try {
    const message = await draftDirective(deps, row, author.freelancerId);
    drafted = (await deps.calls.run({ callId: call.id, scope: node, message, request: deps.request, directive: true })).ok;
  } finally {
    if (!drafted) await releaseDraftCall(db, call.id);
  }
  return drafted ? "drafted" : "failed";
}

// Prepares a quote for the next open request this person can answer and has no draft for: at most one per call, one
// ever per person and request. It runs when they open Home, and catches whatever an arrival could not prepare.
export async function prepareNextDraft(deps: Deps, scope: ResolvedNode): Promise<{ title: string } | null> {
  const seller = scope.seller;
  if (!seller || seller.role.product !== "services") return null;
  const { db } = deps.actions;
  const settings = await getServicesTeamSettings(db, seller.id);
  if (!settings?.agentQuotes) return null;
  const quoting = (await listTeamProjects(db, seller.id)).filter((row) => row.status === "quoting");
  for (const row of quoting) {
    const result = await draftQuote(deps, seller, settings, scope.userId, row);
    if (result === "drafted") return { title: row.title };
    if (result === "failed") return null;
  }
  return null;
}

// The assigned person first, then whoever on the staff the quoting mode lets answer, admins before managers.
function draftCandidates(row: Row, people: Awaited<ReturnType<typeof teamPeople>>): string[] {
  const staff = people.filter((person) => isProjectStaff(person.role));
  const ordered = [...staff.filter((person) => person.role === "admin"), ...staff.filter((person) => person.role !== "admin")];
  return [...new Set([...(row.assignedFreelancerId ? [row.assignedFreelancerId] : []), ...ordered.map((person) => person.userId)])];
}

async function draftArrival(deps: Deps, event: { teamId: string; projectId: string | null }, now: Date): Promise<Drafted> {
  const { db } = deps.actions;
  const row = event.projectId ? await findProjectById(db, event.projectId) : null;
  // Client requests only: a project the team opened itself has no brief to price.
  if (!row || row.teamId !== event.teamId || row.status !== "quoting" || row.source !== "web") return "refused";
  const settings = await getServicesTeamSettings(db, row.teamId);
  if (!settings?.agentQuotes) return "refused";
  // Anyone can send a request, so what a stranger can spend on the model has a ceiling. Past it, Home still prepares.
  if ((await countDraftsSince(db, { teamId: row.teamId, since: startOfUtcDay(now) })) >= deps.calls.dailyTurns) return "refused";
  for (const userId of draftCandidates(row, await teamPeople(db, row.teamId))) {
    const node = await resolveNode(deps, userId, { kind: "seller", teamId: row.teamId });
    if (!node?.seller) continue;
    const result = await draftQuote(deps, node.seller, settings, userId, row);
    if (result !== "refused") return result;
  }
  return "refused";
}

// Prepares quotes for requests that just arrived or were just assigned, as the person who would answer them. Each
// event is picked up once; if the turn fails, the person's next visit to Home prepares it instead.
export async function draftArrivedRequests(deps: Deps, input: { limit: number }): Promise<{ drafted: number; failed: number }> {
  const now = deps.actions.now?.() ?? new Date();
  const since = new Date(now.getTime() - ARRIVAL_WINDOW_MS);
  const events = await claimArrivedRequests(deps.actions.db, { since, now, limit: input.limit });
  const totals = { drafted: 0, failed: 0 };
  for (const event of events) {
    const result = await draftArrival(deps, event, now).catch((): Drafted => "failed");
    if (result === "drafted") totals.drafted += 1;
    if (result === "failed") totals.failed += 1;
  }
  return totals;
}
