import { canServicesTeam, entitlementsFor } from "@jendal-workspace/core";
import { canStore, canWorkspace, storeRoleFor } from "@jendal-workspace/core/context/node";
import type { Database } from "@jendal-workspace/db";
import { billingSnapshot, getBillingAccount } from "@jendal-workspace/db/repositories/billing";
import { listOrganizationsWithServicesTeams } from "@jendal-workspace/db/repositories/services-teams";
import { listOrganizationsWithStores } from "@jendal-workspace/db/repositories/stores";
import { z } from "zod";

import { listProductSummaries } from "../catalog/service";
import { listOrders } from "../use-cases/orders";
import { personOf } from "./actors";
import { defineAction } from "./define";
import { ActionError } from "./errors";

// Reads above and beside the services team (context graph inventory §5, decision 4): a store's catalog and orders, a
// workspace and the person's workspaces. Each checks its own kind of place, through its own grant.

type OpenableSeller = { name: string; slug: string; kind: "services team" | "store"; role: string };
type WorkspaceSellers = { id: string; name: string; role: string; sellers: OpenableSeller[] };

// The person's workspaces, each with the sellers they may open in it: services teams where they hold a role, stores
// they run or staff. Stores they may not open are left out, not marked.
async function workspacesOf(db: Database, userId: string): Promise<WorkspaceSellers[]> {
  const [teams, stores] = await Promise.all([listOrganizationsWithServicesTeams(db, userId), listOrganizationsWithStores(db, userId)]);
  const byId = new Map<string, WorkspaceSellers>();
  for (const entry of teams) {
    byId.set(entry.organization.id, {
      ...entry.organization,
      role: entry.role,
      sellers: entry.servicesTeams.map(({ team, role }) => ({ name: team.name, slug: team.slug, kind: "services team", role })),
    });
  }
  for (const entry of stores) {
    const workspace = byId.get(entry.organization.id) ?? { ...entry.organization, role: entry.role, sellers: [] };
    for (const { store, isTeamMember } of entry.stores) {
      const role = storeRoleFor(entry.role, isTeamMember);
      if (role) workspace.sellers.push({ name: store.name, slug: store.slug, kind: "store", role });
    }
    byId.set(workspace.id, workspace);
  }
  return [...byId.values()];
}

export const workspaceListMine = defineAction({
  name: "workspace.list_mine",
  kind: "query",
  summary: "List the person's workspaces, their role in each, and the services teams and stores they can open there.",
  input: z.object({}),
  output: null,
  surfaces: ["web"],
  scope: () => ({}),
  allow: [{ grant: "signed_in" }],
  run: async ({ deps, actor }) => {
    const person = personOf(actor);
    if (!person) throw new ActionError("forbidden", "Sign in first.");
    return workspacesOf(deps.db, person);
  },
});

export const workspaceSummary = defineAction({
  name: "workspace.summary",
  kind: "query",
  summary:
    "Summarize the current workspace: the person's role, the services teams and stores they can open, and, for owners and admins, the plan and its state (trial, active, grace, lapsed).",
  input: z.object({}),
  output: null,
  surfaces: ["web"],
  scope: () => ({}),
  allow: [{ grant: "workspace_member" }],
  run: async ({ deps, actor, scope }) => {
    const person = personOf(actor);
    const workspace = scope.workspace;
    if (!person || !workspace) throw new ActionError("not_found", "Workspace not found.");
    const mine = (await workspacesOf(deps.db, person)).find((w) => w.id === workspace.id);
    if (!mine) throw new ActionError("not_found", "Workspace not found.");
    if (!canWorkspace(workspace.role, "manage_billing")) return { ...mine, plan: null };
    const account = await getBillingAccount(deps.db, workspace.id);
    if (!account) return { ...mine, plan: null };
    const entitlements = entitlementsFor(billingSnapshot(account), deps.now?.() ?? new Date());
    return {
      ...mine,
      plan: {
        state: entitlements.state,
        canSell: entitlements.canSell,
        services: entitlements.services?.name ?? null,
        store: entitlements.store?.name ?? null,
        trialEndsAt: account.trialEndsAt.toISOString(),
        graceEndsAt: entitlements.graceEndsAt?.toISOString() ?? null,
      },
    };
  },
});

export const productList = defineAction({
  name: "product.list",
  kind: "query",
  summary: "List the store's products, oldest first, with each one's status, price range, variants and stock.",
  input: z.object({}),
  output: null,
  surfaces: ["web"],
  scope: () => ({}),
  allow: [{ grant: "store_member" }],
  run: async ({ deps, scope }) => {
    if (!scope.teamId || !canStore(scope.store, "view_catalog")) throw new ActionError("forbidden", "You cannot see this store's products.");
    const products = await listProductSummaries(deps.db, { storeId: scope.teamId });
    return products.map(({ imageKey: _imageKey, ...product }) => ({ ...product, updatedAt: product.updatedAt.toISOString() }));
  },
});

export const orderList = defineAction({
  name: "order.list",
  kind: "query",
  summary: "List the seller's orders, newest first, with each one's product, buyer email, amount, status and refund. Store staff and services admins.",
  input: z.object({}),
  output: null,
  surfaces: ["web"],
  scope: () => ({}),
  allow: [{ grant: "store_member" }, { grant: "member" }],
  run: async ({ deps, scope }) => {
    const allowed = scope.store !== null ? canStore(scope.store, "view_orders") : canServicesTeam(scope.role, "manage_settings");
    if (!scope.teamId || !allowed) throw new ActionError("forbidden", "Only an admin can see orders.");
    return listOrders(deps.db, scope.teamId);
  },
});

export const SELLER_ACTIONS = [workspaceListMine, workspaceSummary, productList, orderList] as const;
