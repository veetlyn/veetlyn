import { describe, expect, it } from "vitest";

import { mergeWorkspaces, workspaceDestinations, type WorkspaceOrganization, type WorkspaceServicesTeam, type WorkspaceStore } from "./workspaces";

const store: WorkspaceStore = { id: "team-1", slug: "acme", name: "Acme", status: "draft" };
const servicesTeam: WorkspaceServicesTeam = { id: "team-2", slug: "acme-studio", name: "Acme Studio", role: "admin" };

describe("mergeWorkspaces", () => {
  it("keeps organizations that exist on only one side", () => {
    expect(
      mergeWorkspaces([{ id: "org-1", name: "Org One", role: "owner", canCreateStores: true, stores: [store] }], []),
    ).toEqual([
      { id: "org-1", name: "Org One", role: "owner", canCreateStores: true, stores: [store], servicesTeams: [] },
    ] satisfies WorkspaceOrganization[]);

    expect(
      mergeWorkspaces([], [{ id: "org-2", name: "Org Two", role: "owner", servicesTeams: [servicesTeam] }]),
    ).toEqual([
      { id: "org-2", name: "Org Two", role: "owner", canCreateStores: false, stores: [], servicesTeams: [servicesTeam] },
    ] satisfies WorkspaceOrganization[]);
  });

  it("merges stores and services teams for the same organization, in first-seen order", () => {
    const merged = mergeWorkspaces(
      [{ id: "org-1", name: "Org One", role: "owner", canCreateStores: true, stores: [store] }],
      [
        { id: "org-2", name: "Org Two", role: "member", servicesTeams: [] },
        { id: "org-1", name: "Org One", role: "owner", servicesTeams: [servicesTeam] },
      ],
    );

    expect(merged.map((o) => o.id)).toEqual(["org-1", "org-2"]);
    expect(merged[0]).toMatchObject({ stores: [store], servicesTeams: [servicesTeam], canCreateStores: true });
  });
});

describe("workspace destinations", () => {
  const org = (id: string, stores: WorkspaceStore[], servicesTeams: WorkspaceServicesTeam[]): WorkspaceOrganization => ({ id, name: `Org ${id}`, role: "owner", canCreateStores: true, stores, servicesTeams });

  it("lists one entry per workspace (organization), opening a single team directly", () => {
    expect(workspaceDestinations([org("1", [], [servicesTeam])])).toEqual([
      { href: "/acme-studio", label: "Org 1", detail: "Acme Studio · Services team", organizationId: "1" },
    ]);
    expect(workspaceDestinations([org("2", [store], [])])).toEqual([
      { href: "/acme", label: "Org 2", detail: "Acme · Store", organizationId: "2" },
    ]);
  });

  it("opens the workspace overview when it holds several teams or none", () => {
    expect(workspaceDestinations([org("3", [store], [servicesTeam]), org("4", [], [])])).toEqual([
      { href: "/w/3", label: "Org 3", detail: "2 teams", organizationId: "3" },
      { href: "/w/4", label: "Org 4", detail: "Set up workspace", organizationId: "4" },
    ]);
  });
});
