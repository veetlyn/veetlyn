import { canServicesTeam } from "../services-teams/permissions";
import type { ServicesTeamRole } from "../services-teams/types";
import { hasStoreWideRole } from "../tenancy/access";

// The context tree (context graph inventory §1): every place a person can stand in the dash, from their account down
// to one record. Where a call is opened decides what the assistant reads and proposes, and what the frame around it
// shows. A node is only a request: the server resolves it against the person's own access before anything uses it.

export const SECTIONS = ["requests", "projects", "money", "storefront", "team", "settings"] as const;
export type Section = (typeof SECTIONS)[number];

export const NODE_KINDS = ["account", "workspace", "seller", "section", "record"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export type ContextNode =
  | { kind: "account" }
  | { kind: "workspace"; organizationId: string }
  | { kind: "seller"; teamId: string }
  | { kind: "section"; teamId: string; section: Section }
  | { kind: "record"; teamId: string; record: { type: "project"; id: string } };

// The seller a node sits under, or null above the sellers.
export function sellerOf(node: ContextNode): string | null {
  return node.kind === "account" || node.kind === "workspace" ? null : node.teamId;
}

// A store's people: workspace owners and admins run it, members of its team are its staff.
export type StoreRole = "admin" | "staff";
export type SellerRole = { product: "services"; role: ServicesTeamRole } | { product: "store"; role: StoreRole };

// `workspaceRole` is the Better Auth member role in the store's organization (comma-separated when several).
export function storeRoleFor(workspaceRole: string, isTeamMember: boolean): StoreRole | null {
  if (hasStoreWideRole(workspaceRole)) return "admin";
  return isTeamMember ? "staff" : null;
}

export type StoreAction = "view_store" | "view_catalog" | "manage_catalog" | "view_orders" | "manage_settings";

const STORE_STAFF_ACTIONS: ReadonlySet<StoreAction> = new Set(["view_store", "view_catalog", "view_orders"]);

export function canStore(role: StoreRole | null, action: StoreAction): boolean {
  if (role === null) return false;
  return role === "admin" || STORE_STAFF_ACTIONS.has(action);
}

export type WorkspaceAction = "view_workspace" | "view_sellers" | "manage_billing" | "create_sellers";

// Every member sees the workspace and the sellers they belong to; owners and admins run billing and add sellers.
export function canWorkspace(workspaceRole: string | null, action: WorkspaceAction): boolean {
  if (workspaceRole === null) return false;
  if (action === "view_workspace" || action === "view_sellers") return true;
  return hasStoreWideRole(workspaceRole);
}

// The pages under each section, by route segment under the seller.
export type SectionPage = "requests" | "projects" | "payments" | "payouts" | "cases" | "services" | "products" | "orders" | "preview" | "members" | "settings";

export type SellerFacts = {
  seller: SellerRole;
  // A services team run by one person: no open requests, payouts or members.
  solo: boolean;
  // A services team that also sells downloads (a store is always selling them).
  storeEnabled: boolean;
};

export type SellerSection = { section: Section; pages: SectionPage[] };

// What a seller holds for this person (calls design §6): the sections, each with the pages their role may open. The
// dash frame and the assistant both read this, so the sidebar and what the assistant offers never disagree. Sections
// with no page are left out.
export function sellerSections(facts: SellerFacts): SellerSection[] {
  const { seller, solo, storeEnabled } = facts;
  const pages: Record<Section, (SectionPage | false)[]> =
    seller.product === "services"
      ? {
          requests: [!solo && "requests"],
          projects: ["projects"],
          money: [
            canServicesTeam(seller.role, "approve_payouts") && "payments",
            !solo && "payouts",
            canServicesTeam(seller.role, "resolve_cases") && "cases",
          ],
          // Services, Members and Settings open for every role; those pages show each role what it may change.
          storefront: [
            "services",
            storeEnabled && "products",
            storeEnabled && canServicesTeam(seller.role, "manage_settings") && "orders",
            canServicesTeam(seller.role, "manage_settings") && "preview",
          ],
          team: [!solo && "members"],
          settings: ["settings"],
        }
      : {
          requests: [],
          projects: [],
          money: [],
          storefront: [
            canStore(seller.role, "view_catalog") && "products",
            canStore(seller.role, "view_orders") && "orders",
            canStore(seller.role, "manage_settings") && "preview",
          ],
          team: [],
          settings: [canStore(seller.role, "manage_settings") && "settings"],
        };
  return SECTIONS.flatMap((section) => {
    const open = pages[section].filter((page): page is SectionPage => page !== false);
    return open.length > 0 ? [{ section, pages: open }] : [];
  });
}
