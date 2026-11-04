import {
  type ContextNode,
  SECTIONS,
  type SellerRole,
  type SellerSection,
  sellerSections,
  type Section,
  storeRoleFor,
} from "@jendal-workspace/core/context/node";
import type { AgentCallRow, CallPlace, CallsUnder } from "@jendal-workspace/db/repositories/calls";
import { getServicesTeamSettings, servicesTeamRoleFor } from "@jendal-workspace/db/repositories/services-teams";
import { findTeamAccess } from "@jendal-workspace/db/repositories/teams";
import { findWorkspaceMembership } from "@jendal-workspace/db/repositories/workspaces";
import { z } from "zod";

import type { RequestMeta } from "../actions/actors";
import { type ActionDeps, perform } from "../actions/perform";
import { projectGet } from "../actions/projects";

// Where a call stands (context graph inventory §1), as the web sends it. Only a request: resolveNode decides what
// the person may open.
const id = z.string().min(1).max(64);
export const contextNodeInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("account") }),
  z.object({ kind: z.literal("workspace"), organizationId: id }),
  z.object({ kind: z.literal("seller"), teamId: id }),
  z.object({ kind: z.literal("section"), teamId: id, section: z.enum(SECTIONS) }),
  z.object({ kind: z.literal("record"), teamId: id, record: z.object({ type: z.literal("project"), id }) }),
]) satisfies z.ZodType<ContextNode>;

export type ResolvedSeller = {
  id: string;
  name: string;
  slug: string;
  role: SellerRole;
  sections: SellerSection[];
};

// A node the person may open now, with what the assistant and the frame need to know about it. Plain data: it crosses
// into the call's own Durable Object with the turn.
export type ResolvedNode = {
  node: ContextNode;
  userId: string;
  workspace: { id: string; name: string; role: string } | null;
  seller: ResolvedSeller | null;
  section: Section | null;
  project: { id: string; title: string } | null;
};

export const AGENT_ID = "dash-assistant";

type Deps = { actions: ActionDeps; request: RequestMeta };

async function sellerFor(deps: Deps, userId: string, teamId: string): Promise<{ seller: ResolvedSeller; organizationId: string } | null> {
  const { db } = deps.actions;
  const access = await findTeamAccess(db, { teamId, userId });
  if (!access) return null;
  const { team } = access;
  if (access.product === "services") {
    const role = await servicesTeamRoleFor(db, teamId, userId);
    if (!role) return null;
    const settings = await getServicesTeamSettings(db, teamId);
    const seller: SellerRole = { product: "services", role };
    const sections = sellerSections({ seller, solo: settings?.solo ?? false, storeEnabled: settings?.storeEnabled ?? false });
    return { seller: { id: team.id, name: team.name, slug: team.slug, role: seller, sections }, organizationId: team.organizationId };
  }
  const role = storeRoleFor(access.role, access.isTeamMember);
  if (!role) return null;
  const seller: SellerRole = { product: "store", role };
  const sections = sellerSections({ seller, solo: false, storeEnabled: true });
  return { seller: { id: team.id, name: team.name, slug: team.slug, role: seller, sections }, organizationId: team.organizationId };
}

// The project as the person may see it now, through the registry like every other read.
async function projectFor(deps: Deps, userId: string, teamId: string, projectId: string) {
  return perform(
    {
      deps: deps.actions,
      actor: { kind: "agent", agentId: AGENT_ID, onBehalfOf: { kind: "user", userId } },
      surface: "agent",
      request: deps.request,
      team: { id: teamId },
    },
    projectGet,
    { projectId },
  )
    .then((view) => ({ id: view.project.id, title: view.project.title }))
    .catch(() => null);
}

// What the person may open at this node now, or null: someone outside a workspace, seller, section or project learns
// nothing about it, as the registry answers.
export async function resolveNode(deps: Deps, userId: string, node: ContextNode): Promise<ResolvedNode | null> {
  const base = { node, userId, workspace: null, seller: null, section: null, project: null };
  if (node.kind === "account") return base;
  if (node.kind === "workspace") {
    const workspace = await findWorkspaceMembership(deps.actions.db, { organizationId: node.organizationId, userId });
    return workspace ? { ...base, workspace } : null;
  }
  const found = await sellerFor(deps, userId, node.teamId);
  if (!found) return null;
  const workspace = await findWorkspaceMembership(deps.actions.db, { organizationId: found.organizationId, userId });
  if (!workspace) return null;
  const resolved = { ...base, workspace, seller: found.seller };
  if (node.kind === "seller") return resolved;
  if (node.kind === "section") {
    return found.seller.sections.some((s) => s.section === node.section) ? { ...resolved, section: node.section } : null;
  }
  if (found.seller.role.product !== "services") return null;
  const project = await projectFor(deps, userId, node.teamId, node.record.id);
  return project ? { ...resolved, project } : null;
}

// The columns a call stores for its node.
export function placeOf(resolved: ResolvedNode): CallPlace {
  return {
    nodeKind: resolved.node.kind,
    organizationId: resolved.workspace?.id ?? null,
    teamId: resolved.seller?.id ?? null,
    section: resolved.section,
    projectId: resolved.project?.id ?? null,
  };
}

// The node a stored call was opened at.
export function nodeOfCall(call: AgentCallRow): ContextNode | null {
  switch (call.nodeKind) {
    case "account":
      return { kind: "account" };
    case "workspace":
      return call.organizationId ? { kind: "workspace", organizationId: call.organizationId } : null;
    case "seller":
      return call.teamId ? { kind: "seller", teamId: call.teamId } : null;
    case "section":
      return call.teamId && call.section ? { kind: "section", teamId: call.teamId, section: call.section } : null;
    case "record":
      // A record call whose project was removed has nothing left to stand on.
      return call.teamId && call.projectId ? { kind: "record", teamId: call.teamId, record: { type: "project", id: call.projectId } } : null;
  }
}

// The calls a node lists: its own and those below it.
export function callsUnder(node: ContextNode): CallsUnder {
  switch (node.kind) {
    case "account":
    case "workspace":
    case "seller":
    case "section":
      return node;
    case "record":
      return { kind: "record", teamId: node.teamId, projectId: node.record.id };
  }
}
