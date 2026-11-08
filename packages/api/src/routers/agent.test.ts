import { createTestAuth } from "@jendal-workspace/auth/testing";
import { createFakeFileStore, type JsonObject } from "@jendal-workspace/core";
import { actionLog } from "@jendal-workspace/db/schema/action-log";
import { conversationMessage } from "@jendal-workspace/db/schema/conversations";
import { servicesTeamMember, servicesTeamSettings } from "@jendal-workspace/db/schema/services-teams";
import { createTestDb, hasTestDatabase, seedOrganization, seedProject, seedStore, truncateAll } from "@jendal-workspace/db/testing/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { inProcessCallRuntime } from "../agent/runtime";
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
    const files = createFakeFileStore();
    const calls = agent && inProcessCallRuntime({ db, platformName: "Platform", files, auth }, agent);
    return appRouter.createCaller({
      db, session: makeSession(userId), environment: "sandbox", platformName: "Platform", auth,
      headers: new Headers(), catalog: createTestCatalogServices(), files, calls,
    });
  }

  async function setup() {
    const { userId: adminId, organizationId, teamId } = await seedServicesTeamWithAgreedAdmin(db, { slug: "walk-crew" });
    const freelancerId = await seedAgreedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const managerId = await seedAgreedServicesTeamMember(db, { organizationId, teamId, role: "manager" });
    const projectId = await seedProject(db, { teamId, title: "Baobab logo", status: "quoting" });
    current = { kind: "seller", teamId };
    return { adminId, freelancerId, managerId, organizationId, teamId, projectId };
  }
  // The node the test's calls open at: the team set up last.
  let current = { kind: "seller" as const, teamId: "" };
  const onProject = (id: string) => ({ kind: "record" as const, teamId: current.teamId, record: { type: "project" as const, id } });

  it("reads with the person's own access, offers only their tools, logs the reads, and stops at the daily cap", async () => {
    const { adminId, freelancerId } = await setup();
    const model = scriptedModel([use("project_list", {}), say("You have one request: Baobab logo.")]);
    const { callId } = await callerFor(adminId, model, 1).agent.ask({ node: current, message: "What needs me?" });

    const toolResult = JSON.stringify(model.requests[1]?.messages.at(-1)?.content);
    expect(toolResult).toContain("Baobab logo");
    const { entries } = await callerFor(adminId).agent.thread({ callId });
    expect(entries.map((e) => [e.author, e.body])).toEqual([
      ["person", "What needs me?"],
      ["assistant", "You have one request: Baobab logo."],
    ]);
    expect(await db.select({ action: actionLog.action, actorKind: actionLog.actorKind, onBehalfOf: actionLog.onBehalfOf }).from(actionLog)).toEqual([
      { action: "project.list", actorKind: "agent", onBehalfOf: { kind: "user", id: adminId } },
    ]);
    await expect(callerFor(adminId, scriptedModel([]), 1).agent.ask({ node: current, callId, message: "And?" })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });

    const freelancerModel = scriptedModel([say("Nothing for you yet.")]);
    await callerFor(freelancerId, freelancerModel).agent.ask({ node: current, message: "Any payouts to approve?" });
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
    const { callId } = await callerFor(adminId, model).agent.ask({ node: onProject(projectId), message: "Ask the client about colours" });

    expect(await db.select().from(conversationMessage)).toEqual([]);
    const { entries } = await callerFor(adminId).agent.thread({ callId });
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

    await expect(callerFor(adminId).agent.confirm({ entryId: proposal.id })).resolves.toEqual({ status: "done", outcome: "Done." });
    const posted = await db.select().from(conversationMessage);
    expect(posted.map((m) => [m.kind, m.body, m.authorUserId])).toEqual([["question", "Which colours should the logo use?", adminId]]);
    await expect(callerFor(adminId).agent.confirm({ entryId: proposal.id })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.select().from(conversationMessage)).toHaveLength(1);
  });

  it("gives a card its facts from the stored input and lists it as waiting on its person only", async () => {
    const { adminId, freelancerId, projectId, teamId } = await setup();
    const model = scriptedModel([
      use("propose_quote_create", {
        card: "Priced from the brief, and this sentence is not the price.",
        input: { projectId, items: [{ description: "Logo", amountMinor: 90_000 }, { description: "Guide", amountMinor: 25_000 }], deliveryDays: 12 },
      }),
      say("I drafted a quote; review it."),
    ]);
    const { callId } = await callerFor(adminId, model).agent.ask({ node: onProject(projectId), message: "Draft the quote" });

    const { entries } = await callerFor(adminId).agent.thread({ callId });
    const expected = {
      kind: "quote",
      cta: "Send quote",
      project: "Baobab logo",
      lines: [{ label: "Logo", amount: "$900.00" }, { label: "Guide", amount: "$250.00" }],
      total: "$1,150.00",
      delivery: "12 days",
    };
    const proposal = entries.find((e) => e.kind === "proposal");
    expect(proposal?.card).toEqual(expected);
    expect(proposal).not.toHaveProperty("input");

    const node = { kind: "seller" as const, teamId };
    const { pending } = await callerFor(adminId).agent.pending({ node });
    expect(pending).toEqual([expect.objectContaining({ callId, title: "Draft the quote", card: expected })]);
    await expect(callerFor(freelancerId).agent.pending({ node })).resolves.toEqual({ pending: [] });

    await callerFor(adminId).agent.decline({ entryId: proposal?.id ?? "" });
    await expect(callerFor(adminId).agent.pending({ node })).resolves.toEqual({ pending: [] });
  });

  // The SDK runs one step's tool calls at once: cards drafted together must keep their order and the per-turn cap.
  it("keeps cards drafted at once in the model's order, and at most three per turn", async () => {
    const { adminId, projectId } = await setup();
    const post = (n: number): Call => ({
      id: `call_${n}`,
      name: "propose_conversation_post",
      input: { card: `Reply ${n}.`, input: { projectId, body: `Message ${n}` } },
    });
    const model = scriptedModel([{ text: null, calls: [post(1), post(2), post(3), post(4)] }, say("Drafted replies.")]);
    const { callId } = await callerFor(adminId, model).agent.ask({ node: current, message: "Draft four replies" });

    const proposals = (await callerFor(adminId).agent.thread({ callId })).entries.filter((e) => e.kind === "proposal");
    expect(proposals.map((p) => p.note)).toEqual(["Reply 1.", "Reply 2.", "Reply 3."]);
  });

  // Walkthrough 2026-11-03: a thank-you drafted on a completed project was a card that Confirm could only refuse.
  it("drafts no card for a message the project would refuse, and tells the model why", async () => {
    const { adminId, teamId } = await setup();
    const done = await seedProject(db, { teamId, title: "Finished logo", status: "completed" });
    const model = scriptedModel([
      use("propose_conversation_post", { card: "Thank the client.", input: { projectId: done, body: "Thanks, the files are ready." } }),
      say("That project is closed to new messages."),
    ]);
    const { callId } = await callerFor(adminId, model).agent.ask({ node: current, message: "Thank the client of the finished logo" });

    expect(JSON.stringify(model.requests[1]?.messages.at(-1)?.content)).toContain("Not proposed: This project is closed to new messages.");
    const { entries } = await callerFor(adminId).agent.thread({ callId });
    expect(entries.filter((e) => e.kind === "proposal")).toEqual([]);
    expect(await db.select().from(conversationMessage)).toEqual([]);
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
    const { callId } = await callerFor(managerId, model).agent.ask({ node: current, message: "Thank the client" });
    const [first, second] = (await callerFor(managerId).agent.thread({ callId })).entries.filter((e) => e.kind === "proposal");
    if (!first || !second) throw new Error("expected two proposals");

    await expect(callerFor(adminId).agent.thread({ callId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(callerFor(adminId).agent.confirm({ entryId: first.id })).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(callerFor(managerId).agent.confirm({ entryId: first.id })).resolves.toMatchObject({ status: "done" });
    await db
      .update(servicesTeamMember)
      .set({ role: "freelancer" })
      .where(and(eq(servicesTeamMember.teamId, teamId), eq(servicesTeamMember.userId, managerId)));
    await expect(callerFor(managerId).agent.confirm({ entryId: second.id })).resolves.toMatchObject({ status: "failed" });
    expect((await db.select().from(conversationMessage)).map((m) => m.body)).toEqual(["Thanks for the brief."]);
  });

  it("opens calls at a store, the workspace and the account, each with only that place's tools", async () => {
    const { adminId, organizationId } = await setup();
    const store = await seedStore(db, { organizationId, slug: "clay-room", name: "Clay Room" });
    const system = (model: ReturnType<typeof scriptedModel>) => JSON.stringify(model.requests[0]?.messages[0]?.content);

    const offered = (model: ReturnType<typeof scriptedModel>) => (model.requests[0]?.tools ?? []).map((t) => t.function.name).sort();
    const atStore = scriptedModel([say("No orders yet.")]);
    await callerFor(adminId, atStore).agent.ask({ node: { kind: "seller", teamId: store.id }, message: "How are sales?" });
    expect(offered(atStore)).toEqual(["order_list", "product_list"]);
    expect(system(atStore)).toContain('the store \\"Clay Room\\"');

    const atWorkspace = scriptedModel([say("Two sellers.")]);
    await callerFor(adminId, atWorkspace).agent.ask({ node: { kind: "workspace", organizationId }, message: "What is in here?" });
    expect(offered(atWorkspace)).toEqual(["workspace_summary"]);
    expect(system(atWorkspace)).toContain("This call is about the whole workspace.");

    const atAccount = scriptedModel([say("Here is everything.")]);
    await callerFor(adminId, atAccount).agent.ask({ node: { kind: "account" }, message: "Anything for me?" });
    expect(system(atAccount)).toContain("at their account");
    expect(offered(atAccount)).toEqual(["payout_mine", "project_client_list", "workspace_list_mine"]);

    const listed = async (node: Parameters<ReturnType<typeof callerFor>["agent"]["calls"]>[0]["node"]) =>
      (await callerFor(adminId).agent.calls({ node })).calls.map((c) => c.nodeKind).sort();
    expect(await listed({ kind: "account" })).toEqual(["account", "seller", "workspace"]);
    expect(await listed({ kind: "workspace", organizationId })).toEqual(["seller", "workspace"]);
    expect(await listed({ kind: "seller", teamId: store.id })).toEqual(["seller"]);
  });

  it("tells someone outside a workspace that its nodes do not exist", async () => {
    const { organizationId, teamId, projectId } = await setup();
    const { userId: strangerId } = await seedOrganization(db);
    const stranger = callerFor(strangerId, scriptedModel([]));

    for (const node of [
      { kind: "workspace" as const, organizationId },
      { kind: "seller" as const, teamId },
      { kind: "section" as const, teamId, section: "money" as const },
      { kind: "record" as const, teamId, record: { type: "project" as const, id: projectId } },
    ]) {
      await expect(stranger.agent.ask({ node, message: "Hello?" })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(stranger.agent.calls({ node })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("keeps a freelancer out of the sections their role does not hold", async () => {
    const { freelancerId, teamId } = await setup();
    const caller = callerFor(freelancerId, scriptedModel([say("Your projects.")]));

    await expect(caller.agent.node({ node: { kind: "section", teamId, section: "settings" } })).resolves.toMatchObject({ scope: { section: "settings" } });
    await expect(caller.agent.node({ node: { kind: "section", teamId, section: "money" } })).resolves.toMatchObject({ scope: { section: "money" } });
    // Payments and PayPal cases stay hidden inside Money; the section opens on the freelancer's own payouts.
    const { scope } = await caller.agent.node({ node: { kind: "seller", teamId } });
    expect(scope.seller?.sections.find((s) => s.section === "money")?.pages).toEqual(["payouts"]);
  });
});
