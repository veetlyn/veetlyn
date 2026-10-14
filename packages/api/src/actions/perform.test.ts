import { createTestAuth } from "@jendal-workspace/auth/testing";
import { createFakeFileStore } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import { actionLog } from "@jendal-workspace/db/schema/action-log";
import {
  createTestDb,
  hasTestDatabase,
  seedProject,
  seedServicesTeam,
  seedServicesTeamMember,
  seedServicesTeamWithAdmin,
  seedUser,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { fromPartial } from "@total-typescript/shoehorn";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { Actor, Surface } from "./actors";
import { defineAction, type Grant } from "./define";
import { ActionError } from "./errors";
import { perform, type ActionDeps } from "./perform";

const projectInput = z.object({ projectId: z.uuid() });

function projectAction(name: string, kind: "action" | "query", allow: Grant[]) {
  return defineAction({
    name,
    kind,
    summary: name,
    input: projectInput,
    output: null,
    scope: (input) => ({ projectId: input.projectId }),
    allow,
    run: async ({ scope }) => ({ projectId: scope.project?.id ?? null, role: scope.role }),
  });
}

const teamQuery = projectAction("test.team_query", "query", [{ grant: "member" }]);
const clientAction = projectAction("test.client_action", "action", [{ grant: "client" }]);

function unscopedAction(name: string, allow: Grant[]) {
  return defineAction({
    name,
    kind: "action",
    summary: name,
    input: z.object({}),
    output: null,
    scope: () => ({}),
    allow,
    run: async () => ({ done: true }),
  });
}

const teamAction = defineAction({
  name: "test.team_action",
  kind: "action",
  summary: "Team action",
  input: z.object({ teamId: z.uuid() }),
  output: null,
  scope: (input) => ({ teamId: input.teamId }),
  allow: [{ grant: "member" }],
  run: async ({ scope }) => ({ teamId: scope.teamId }),
});

const publicAction = unscopedAction("test.public_action", [{ grant: "anyone" }]);
const memberAction = unscopedAction("test.member_action", [{ grant: "member" }]);

const throwing = defineAction({
  name: "test.throws",
  kind: "action",
  summary: "Throws",
  input: z.object({}),
  output: null,
  scope: () => ({}),
  allow: [{ grant: "anyone" }],
  run: async () => {
    throw new TRPCError({ code: "BAD_GATEWAY", message: "PayPal did not answer." });
  },
});

describe.skipIf(!hasTestDatabase)("perform", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);
  const deps: ActionDeps = { db, files: createFakeFileStore(), auth };
  const request = { requestId: "req-1", ip: "203.0.113.7" };

  const call = (actor: Actor, surface: Surface = "api", overrides: { deps?: ActionDeps; team?: { id: string } } = {}) => ({
    deps: overrides.deps ?? deps,
    actor,
    surface,
    request,
    team: overrides.team,
  });

  async function seedTeamProject() {
    const { organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    const freelancerId = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const projectId = await seedProject(db, { teamId });
    return { organizationId, teamId, freelancerId, projectId };
  }

  const logRows = () => db.select().from(actionLog);

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("returns the result to a team member and logs the actor and the project", async () => {
    const { teamId, freelancerId, projectId } = await seedTeamProject();

    const result = await perform(call({ kind: "user", userId: freelancerId }), teamQuery, { projectId });

    expect(result).toEqual({ projectId, role: "freelancer" });
    const rows = await logRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      requestId: "req-1",
      action: "test.team_query",
      surface: "api",
      teamId,
      projectId,
      actorKind: "user",
      actorId: freelancerId,
      onBehalfOf: null,
      ip: "203.0.113.7",
      outcome: "ok",
      message: null,
    });
  });

  it("tells a signed-in user with no role in the team that the project does not exist", async () => {
    const { projectId } = await seedTeamProject();
    const outsider = await seedUser(db, "Outsider");

    await expect(perform(call({ kind: "user", userId: outsider }), teamQuery, { projectId })).rejects.toMatchObject({
      code: "not_found",
      message: "Project not found.",
    });
  });

  it("refuses a project reached through another team's slug", async () => {
    const { organizationId, freelancerId, projectId } = await seedTeamProject();
    const otherTeam = await seedServicesTeam(db, { organizationId, slug: "other" });

    await expect(
      perform(call({ kind: "user", userId: freelancerId }, "api", { team: { id: otherTeam.id } }), teamQuery, {
        projectId,
      }),
    ).rejects.toMatchObject({ code: "not_found", message: "Project not found." });
  });

  it("refuses a team action whose input names another team than the adapter's", async () => {
    const { organizationId, teamId, freelancerId } = await seedTeamProject();
    const otherTeam = await seedServicesTeam(db, { organizationId, slug: "other" });

    await expect(
      perform(call({ kind: "user", userId: freelancerId }, "api", { team: { id: otherTeam.id } }), teamAction, {
        teamId,
      }),
    ).rejects.toMatchObject({ code: "not_found", message: "Team not found." });
  });

  it("lets a client link act on its own project only", async () => {
    const { teamId, projectId } = await seedTeamProject();
    const otherProjectId = await seedProject(db, { teamId, title: "Other" });
    const actor: Actor = { kind: "client_link", token: { projectId } };

    await expect(perform(call(actor), clientAction, { projectId })).resolves.toEqual({ projectId, role: null });
    await expect(perform(call(actor), clientAction, { projectId: otherProjectId })).rejects.toMatchObject({
      code: "not_found",
      message: "Project not found.",
    });
  });

  it("lets an anonymous visitor through an open grant but not a member one", async () => {
    await expect(perform(call({ kind: "anonymous" }), publicAction, {})).resolves.toEqual({ done: true });
    await expect(perform(call({ kind: "anonymous" }), memberAction, {})).rejects.toMatchObject({
      code: "forbidden",
      message: "You cannot do this.",
    });
  });

  it("refuses an agent whatever the grant and logs who it acted for", async () => {
    const { freelancerId, projectId } = await seedTeamProject();
    const agent: Actor = { kind: "agent", agentId: "agent-1", onBehalfOf: { kind: "user", userId: freelancerId } };
    const onBehalfOf = { kind: "user", id: freelancerId };

    const refused = { code: "forbidden", message: "Agents cannot do this yet." };
    await expect(perform(call(agent), publicAction, {})).rejects.toMatchObject(refused);
    await expect(perform(call(agent), teamQuery, { projectId })).rejects.toMatchObject(refused);
    const rows = await logRows();
    expect(rows.map((row) => [row.actorKind, row.actorId, row.onBehalfOf, row.outcome])).toEqual([
      ["agent", "agent-1", onBehalfOf, "forbidden"],
      ["agent", "agent-1", onBehalfOf, "forbidden"],
    ]);
  });

  it("turns a use case's tRPC error into an action error and logs it", async () => {
    const rejection = perform(call({ kind: "anonymous" }), throwing, {});

    await expect(rejection).rejects.toBeInstanceOf(ActionError);
    const [row] = await logRows();
    expect(row).toMatchObject({ action: "test.throws", outcome: "unavailable", message: "PayPal did not answer." });
  });

  it("logs a query from the API but not from the web app", async () => {
    const { freelancerId, projectId } = await seedTeamProject();
    const actor: Actor = { kind: "user", userId: freelancerId };

    await perform(call(actor, "web"), teamQuery, { projectId });
    expect(await logRows()).toHaveLength(0);
    await perform(call(actor, "api"), teamQuery, { projectId });
    expect(await logRows()).toHaveLength(1);
  });

  it("names the fields that failed validation", async () => {
    const { freelancerId } = await seedTeamProject();

    await expect(
      perform(call({ kind: "user", userId: freelancerId }), teamQuery, { projectId: "not-a-uuid" }),
    ).rejects.toMatchObject({ code: "invalid", details: { projectId: [expect.any(String)] } });
  });

  it("returns the result when the log cannot be written", async () => {
    const { freelancerId, projectId } = await seedTeamProject();
    const onLogError = vi.fn();
    const failingDb = fromPartial<Database>({
      select: db.select.bind(db),
      insert: (table: Parameters<Database["insert"]>[0]) => {
        if (table === actionLog) throw new Error("action_log is unavailable");
        return db.insert(table);
      },
    });

    const result = await perform(
      call({ kind: "user", userId: freelancerId }, "api", { deps: { ...deps, db: failingDb, onLogError } }),
      teamQuery,
      { projectId },
    );

    expect(result).toEqual({ projectId, role: "freelancer" });
    expect(onLogError).toHaveBeenCalledOnce();
  });
});
