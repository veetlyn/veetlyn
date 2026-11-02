import Anthropic from "@anthropic-ai/sdk";
import { createTestAuth } from "@jendal-workspace/auth/testing";
import { createFakeFileStore, type JsonObject } from "@jendal-workspace/core";
import { actionLog } from "@jendal-workspace/db/schema/action-log";
import { conversationMessage } from "@jendal-workspace/db/schema/conversations";
import { servicesTeamMember, servicesTeamSettings } from "@jendal-workspace/db/schema/services-teams";
import { createTestDb, hasTestDatabase, seedProject, truncateAll } from "@jendal-workspace/db/testing/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { AgentServices } from "../context";
import { makeSession } from "../testing";
import { createTestCatalogServices } from "../testing/catalog";
import { seedAgreedServicesTeamMember, seedServicesTeamWithAgreedAdmin } from "../testing/rulebooks";
import { appRouter } from "./index";

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: JsonObject };

// The model, faked at fetch: each request takes the next scripted answer and is kept for inspection.
function scriptedModel(answers: { content: Block[]; stop_reason: string }[]) {
  const requests: { tools: { name: string }[]; messages: { role: string; content: unknown }[] }[] = [];
  const fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    const next = answers.shift();
    if (!next) throw new Error("The model was called more often than scripted.");
    const body = { id: `msg_${requests.length}`, type: "message", role: "assistant", model: "claude-opus-5-5", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }, ...next };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetch, requests };
}

const say = (text: string) => ({ content: [{ type: "text" as const, text }], stop_reason: "end_turn" });
const use = (name: string, input: JsonObject) => ({
  content: [{ type: "tool_use" as const, id: `toolu_${name}`, name, input }],
  stop_reason: "tool_use",
});

describe.skipIf(!hasTestDatabase)("agent calls", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  function callerFor(userId: string, model?: ReturnType<typeof scriptedModel>, dailyTurns = 50) {
    const agent: AgentServices | undefined = model && {
      client: new Anthropic({ apiKey: "test-key", fetch: model.fetch, maxRetries: 0 }),
      model: "claude-opus-5-5",
      anthropicApi: true,
      dailyTurns,
    };
    return appRouter.createCaller({
      db, session: makeSession(userId), environment: "sandbox", platformName: "Platform", auth,
      headers: new Headers(), catalog: createTestCatalogServices(), files: createFakeFileStore(), agent,
    });
  }

  async function setup() {
    const { userId: adminId, organizationId, teamId } = await seedServicesTeamWithAgreedAdmin(db, { slug: "walk-crew" });
    const freelancerId = await seedAgreedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const managerId = await seedAgreedServicesTeamMember(db, { organizationId, teamId, role: "manager" });
    const projectId = await seedProject(db, { teamId, title: "Baobab logo", status: "quoting" });
    return { adminId, freelancerId, managerId, teamId, projectId };
  }
  const TEAM = { teamSlug: "walk-crew" };

  it("reads with the person's own access, offers only their tools, logs the reads, and stops at the daily cap", async () => {
    const { adminId, freelancerId } = await setup();
    const model = scriptedModel([use("project_list", {}), say("You have one request: Baobab logo.")]);
    const { callId } = await callerFor(adminId, model, 1).agent.ask({ ...TEAM, message: "What needs me?" });

    const toolResult = JSON.stringify(model.requests[1]?.messages.at(-1)?.content);
    expect(toolResult).toContain("Baobab logo");
    const { entries } = await callerFor(adminId).agent.thread({ ...TEAM, callId });
    expect(entries.map((e) => [e.author, e.body])).toEqual([
      ["person", "What needs me?"],
      ["assistant", "You have one request: Baobab logo."],
    ]);
    expect(await db.select({ action: actionLog.action, actorKind: actionLog.actorKind, onBehalfOf: actionLog.onBehalfOf }).from(actionLog)).toEqual([
      { action: "project.list", actorKind: "agent", onBehalfOf: { kind: "user", id: adminId } },
    ]);
    await expect(callerFor(adminId, scriptedModel([]), 1).agent.ask({ ...TEAM, callId, message: "And?" })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });

    const freelancerModel = scriptedModel([say("Nothing for you yet.")]);
    await callerFor(freelancerId, freelancerModel).agent.ask({ ...TEAM, message: "Any payouts to approve?" });
    const offered = freelancerModel.requests[0]?.tools.map((t) => t.name) ?? [];
    expect(offered).toContain("project_list");
    expect(offered).not.toContain("payout_list");
    expect(offered).not.toContain("propose_payout_approve");
  });

  it("changes nothing until the person confirms a proposal, then runs it once as them", async () => {
    const { adminId, projectId } = await setup();
    const model = scriptedModel([
      use("propose_conversation_post", {
        card: "Ask Lina which colours the logo should use.",
        input: { projectId, kind: "question", body: "Which colours should the logo use?" },
      }),
      say("I drafted a question for Lina; confirm it to send."),
    ]);
    const { callId } = await callerFor(adminId, model).agent.ask({ ...TEAM, projectId, message: "Ask the client about colours" });

    expect(await db.select().from(conversationMessage)).toEqual([]);
    const { entries } = await callerFor(adminId).agent.thread({ ...TEAM, callId });
    const proposal = entries.find((e) => e.kind === "proposal");
    expect(proposal).toMatchObject({ body: "Ask Lina which colours the logo should use.", status: "pending" });
    if (!proposal) throw new Error("no proposal");

    await expect(callerFor(adminId).agent.confirm({ ...TEAM, entryId: proposal.id })).resolves.toEqual({ status: "done", outcome: "Done." });
    const posted = await db.select().from(conversationMessage);
    expect(posted.map((m) => [m.kind, m.body, m.authorUserId])).toEqual([["question", "Which colours should the logo use?", adminId]]);
    await expect(callerFor(adminId).agent.confirm({ ...TEAM, entryId: proposal.id })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.select().from(conversationMessage)).toHaveLength(1);
  });

  it("refuses a confirmed proposal the person may no longer make, and keeps calls private", async () => {
    const { adminId, managerId, teamId, projectId } = await setup();
    await db.update(servicesTeamSettings).set({ quotingMode: "assigned" }).where(eq(servicesTeamSettings.teamId, teamId));
    const post = (id: string, body: string) => ({
      type: "tool_use" as const,
      id,
      name: "propose_conversation_post",
      input: { card: body, input: { projectId, body } },
    });
    const model = scriptedModel([
      { content: [post("toolu_1", "Thanks for the brief."), post("toolu_2", "We start Monday.")], stop_reason: "tool_use" },
      say("Drafted two messages."),
    ]);
    const { callId } = await callerFor(managerId, model).agent.ask({ ...TEAM, message: "Thank the client" });
    const [first, second] = (await callerFor(managerId).agent.thread({ ...TEAM, callId })).entries.filter((e) => e.kind === "proposal");
    if (!first || !second) throw new Error("expected two proposals");

    await expect(callerFor(adminId).agent.thread({ ...TEAM, callId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(callerFor(adminId).agent.confirm({ ...TEAM, entryId: first.id })).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(callerFor(managerId).agent.confirm({ ...TEAM, entryId: first.id })).resolves.toMatchObject({ status: "done" });
    await db
      .update(servicesTeamMember)
      .set({ role: "freelancer" })
      .where(and(eq(servicesTeamMember.teamId, teamId), eq(servicesTeamMember.userId, managerId)));
    await expect(callerFor(managerId).agent.confirm({ ...TEAM, entryId: second.id })).resolves.toMatchObject({ status: "failed" });
    expect((await db.select().from(conversationMessage)).map((m) => m.body)).toEqual(["Thanks for the brief."]);
  });
});
