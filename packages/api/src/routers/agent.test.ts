import { createTestAuth } from "@jendal-workspace/auth/testing";
import { createFakeFileStore, type JsonObject } from "@jendal-workspace/core";
import { actionLog } from "@jendal-workspace/db/schema/action-log";
import { conversationMessage } from "@jendal-workspace/db/schema/conversations";
import { servicesTeamMember, servicesTeamSettings } from "@jendal-workspace/db/schema/services-teams";
import { createTestDb, hasTestDatabase, seedProject, truncateAll } from "@jendal-workspace/db/testing/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createAgentServices } from "../agent/services";
import { makeSession } from "../testing";
import { createTestCatalogServices } from "../testing/catalog";
import { seedAgreedServicesTeamMember, seedServicesTeamWithAgreedAdmin } from "../testing/rulebooks";
import { appRouter } from "./index";

type Call = { id: string; name: string; input: JsonObject };
type Answer = { text: string | null; calls: Call[] };
type ChatRequest = { tools?: { function: { name: string } }[]; messages: { role: string; content: unknown }[] };

// The model, faked at fetch as an OpenAI-compatible chat endpoint: each request takes the next scripted answer and is
// kept for inspection.
function scriptedModel(answers: Answer[]) {
  const requests: ChatRequest[] = [];
  const fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    const next = answers.shift();
    if (!next) throw new Error("The model was called more often than scripted.");
    const toolCalls = next.calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) } }));
    const message = { role: "assistant", content: next.text, tool_calls: toolCalls.length > 0 ? toolCalls : undefined };
    const body = {
      id: `chat_${requests.length}`,
      object: "chat.completion",
      created: 1,
      model: "muse-spark",
      choices: [{ index: 0, message, finish_reason: next.calls.length > 0 ? "tool_calls" : "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetch, requests };
}

const say = (text: string): Answer => ({ text, calls: [] });
const use = (name: string, input: JsonObject, id = `call_${name}`): Answer => ({ text: null, calls: [{ id, name, input }] });

describe.skipIf(!hasTestDatabase)("agent calls", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  function callerFor(userId: string, model?: ReturnType<typeof scriptedModel>, dailyTurns = 50) {
    const agent =
      model &&
      createAgentServices(
        { apiKey: "test-key", baseUrl: "https://model.test/v1", model: "muse-spark", dailyTurns: String(dailyTurns) },
        model.fetch,
      );
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
    const offered = freelancerModel.requests[0]?.tools?.map((t) => t.function.name) ?? [];
    expect(offered).toContain("project_list");
    expect(offered).not.toContain("payout_list");
    expect(offered).not.toContain("propose_payout_approve");
  });

  it("shows the card from the input that will run, changes nothing until confirmed, then runs it once as the person", async () => {
    const { adminId, projectId } = await setup();
    const elsewhere = await seedServicesTeamWithAgreedAdmin(db, { slug: "rival" });
    const rivalProject = await seedProject(db, { teamId: elsewhere.teamId, title: "Rival work", status: "quoting" });
    const model = scriptedModel([
      {
        text: null,
        calls: [
          {
            id: "call_1",
            name: "propose_conversation_post",
            input: { card: "Just a friendly hello.", input: { projectId, kind: "question", body: "Which colours should the logo use?" } },
          },
          {
            id: "call_2",
            name: "propose_conversation_post",
            input: { card: "Thank the client.", input: { projectId: rivalProject, body: "Leaked text" } },
          },
        ],
      },
      say("I drafted a question for Lina; confirm it to send."),
    ]);
    const { callId } = await callerFor(adminId, model).agent.ask({ ...TEAM, projectId, message: "Ask the client about colours" });

    expect(await db.select().from(conversationMessage)).toEqual([]);
    const { entries } = await callerFor(adminId).agent.thread({ ...TEAM, callId });
    const proposals = entries.filter((e) => e.kind === "proposal");
    expect(proposals).toEqual([
      expect.objectContaining({
        body: "Ask the client on “Baobab logo”: “Which colours should the logo use?”",
        note: "Just a friendly hello.",
        status: "pending",
      }),
    ]);
    const proposal = proposals[0];
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
    const post = (id: string, body: string): Call => ({
      id,
      name: "propose_conversation_post",
      input: { card: "A reply.", input: { projectId, body } },
    });
    const model = scriptedModel([{ text: null, calls: [post("call_1", "Thanks for the brief."), post("call_2", "We start Monday.")] }, say("Drafted two messages.")]);
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
