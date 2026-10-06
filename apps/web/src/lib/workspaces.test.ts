import { describe, expect, it } from "vitest";

import { mergeWorkspaces, type WorkspaceOrganization, type WorkspaceServicesTeam, type WorkspaceStore } from "./workspaces";

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
