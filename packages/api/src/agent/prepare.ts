import { formatMoney, money, quoteAuthor } from "@jendal-workspace/core";
import { createAgentCall, findLatestOwnCallAt, listAgentCallEntries } from "@jendal-workspace/db/repositories/calls";
import { listTeamProjects, listProjectQuotes } from "@jendal-workspace/db/repositories/projects";
import { findServicesOffering } from "@jendal-workspace/db/repositories/services-catalog";
import { getServicesTeamSettings } from "@jendal-workspace/db/repositories/services-teams";

import type { RequestMeta } from "../actions/actors";
import type { ActionDeps } from "../actions/perform";
import { placeOf, resolveNode, type ResolvedNode } from "./node";
import type { CallRuntime } from "./runtime";

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

// Prepares a quote for the next open request this person can answer and has no draft for: at most one per call, one
// ever per person and request, as that person and only proposing. It runs when they arrive, so it needs no one
// else's identity, and only people who can send a quote spend model calls.
export async function prepareNextDraft(deps: Deps, scope: ResolvedNode): Promise<{ title: string } | null> {
  const seller = scope.seller;
  if (!seller || seller.role.product !== "services") return null;
  const { db } = deps.actions;
  const settings = await getServicesTeamSettings(db, seller.id);
  if (!settings) return null;
  const quoting = (await listTeamProjects(db, seller.id)).filter((row) => row.status === "quoting");
  for (const row of quoting) {
    if ((await listProjectQuotes(db, row.id)).length > 0) continue;
    // A draft this person could never send is worse than none: the quoting mode decides, as it will on confirm.
    const author = quoteAuthor({
      role: seller.role.role,
      actorId: scope.userId,
      quotingMode: settings.quotingMode,
      assignedFreelancerId: row.assignedFreelancerId,
      // Unassigned work is drafted as the person preparing it; the card names them, and they can ask for someone else.
      freelancerId: row.assignedFreelancerId ?? scope.userId,
      solo: settings.solo,
    });
    if (!author.ok) continue;
    const node = await resolveNode(deps, scope.userId, { kind: "record", teamId: seller.id, record: { type: "project", id: row.id } });
    if (!node) continue;
    const place = { ...placeOf(node), userId: scope.userId, title: `Quote for ${row.title}`.slice(0, 80) };
    const earlier = await findLatestOwnCallAt(db, place);
    // A draft that failed before writing anything is tried again in the same thread.
    if (earlier && (await listAgentCallEntries(db, earlier.id)).length > 0) continue;
    const call = earlier ?? (await createAgentCall(db, place));
    const outcome = await deps.calls.run({ callId: call.id, scope: node, message: await draftDirective(deps, row, author.freelancerId), request: deps.request, directive: true });
    return outcome.ok ? { title: row.title } : null;
  }
  return null;
}
