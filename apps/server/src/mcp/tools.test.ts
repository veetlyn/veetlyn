import { addQuote } from "@jendal-workspace/api/use-cases/projects";
import { postConversationMessage } from "@jendal-workspace/api/use-cases/conversations";
import { seedAgreedServicesTeamMember } from "@jendal-workspace/api/testing/rulebooks";
import { createTestAuth } from "@jendal-workspace/auth/testing";
import { createFakeFileStore, type JsonObject } from "@jendal-workspace/core";
import { createDb, type Database } from "@jendal-workspace/db";
import { findProjectById } from "@jendal-workspace/db/repositories/projects";
import { user } from "@jendal-workspace/db/schema/auth";
import { conversationMessage } from "@jendal-workspace/db/schema/conversations";
import { member } from "@jendal-workspace/db/schema/organization";
import { project } from "@jendal-workspace/db/schema/projects";
import { servicesTeamSettings } from "@jendal-workspace/db/schema/services-teams";
import {
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedServicesOffering,
  seedServicesTeam,
  seedUser,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { createFakeMailer } from "@jendal-workspace/email/fake";
import { fromPartial } from "@total-typescript/shoehorn";
import { eq } from "drizzle-orm";
import type { RequestLogger } from "evlog";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { mcpRequestHandler } from "./route";
import type { McpDeps } from "./tools";

const origins = { api: "https://api.platform.test", storeWildcard: "https://*.platform.test" };

const rpcResponse = z.object({
  result: z
    .object({
      content: z.array(z.object({ type: z.string(), text: z.string() })).optional(),
      structuredContent: z.record(z.string(), z.any()).optional(),
      _meta: z.record(z.string(), z.any()).optional(),
      isError: z.boolean().optional(),
      tools: z.array(z.object({ name: z.string(), _meta: z.record(z.string(), z.any()).optional() })).optional(),
    })
    .optional(),
  error: z.object({ message: z.string() }).optional(),
});

// Claude's era (2025-11-25) answers each request as a server-sent event stream.
async function call(handler: (request: Request) => Promise<Response>, method: string, params: JsonObject) {
  const response = await handler(
    new Request("https://api.platform.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  const body = await response.text();
  const data = body
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice("data: ".length);
  return rpcResponse.parse(JSON.parse(data ?? body));
}

const textOf = (r: z.infer<typeof rpcResponse>) => r.result?.content?.map((c) => c.text).join("\n") ?? "";

describe.skipIf(!hasTestDatabase)("the plugin's tools", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  function depsFor(userId: string, database: Database = db): McpDeps {
    return {
      actions: {
        db: database,
        platformName: "Platform",
        files: createFakeFileStore(),
        auth,
        email: {
          mailer: createFakeMailer(),
          siteOrigin: "https://platform.test",
          platformName: "Platform",
          dashOrigin: "https://dash.platform.test",
          storeOrigin: (slug) => `https://${slug}.platform.test`,
        },
      },
      auth,
      log: fromPartial<RequestLogger>({ set: () => {} }),
      userId,
      platformName: "Platform",
      storeOrigin: (slug) => `https://${slug}.platform.test`,
    };
  }

  const tool = (userId: string, name: string, args: JsonObject) =>
    call(mcpRequestHandler(depsFor(userId), origins), "tools/call", { name, arguments: args });

  async function consent(userId: string, offeringId: string) {
    const terms = await tool(userId, "get_request_terms", { offeringId });
    return { termsAccepted: true, acceptedRulebookId: z.string().parse(terms.result?.structuredContent?.rulebookId) };
  }

  async function setup() {
    const { organizationId } = await seedOrganization(db);
    const team = await seedServicesTeam(db, { organizationId, slug: "walk-crew", name: "Walk Crew", status: "active" });
    await db.update(servicesTeamSettings).set({ quotingMode: "open" }).where(eq(servicesTeamSettings.teamId, team.id));
    const offeringId = await seedServicesOffering(db, { teamId: team.id, name: "Logo refresh" });
    const aicha = await seedAgreedServicesTeamMember(db, { organizationId, teamId: team.id, role: "freelancer", name: "Aïcha" });
    const ben = await seedAgreedServicesTeamMember(db, { organizationId, teamId: team.id, role: "freelancer", name: "Ben" });
    const clientId = await seedUser(db, "Ann");
    await db.update(user).set({ email: "ann@example.com", emailVerified: true }).where(eq(user.id, clientId));
    return { organizationId, teamId: team.id, offeringId, aicha, ben, clientId };
  }

  async function requested() {
    const fixture = await setup();
    const sent = await tool(fixture.clientId, "request_quote", {
      offeringId: fixture.offeringId,
      brief: "A warm logo for my bakery, files at drive.google.com/x",
      ...await consent(fixture.clientId, fixture.offeringId),
    });
    const projectId = z.string().parse(sent.result?.structuredContent?.project?.id);
    return { ...fixture, projectId };
  }

  it("shows current terms before a request and refuses unchecked consent", async () => {
    const { clientId, offeringId } = await setup();
    const terms = await tool(clientId, "get_request_terms", { offeringId });
    expect(terms.result?.isError).not.toBe(true);
    expect(textOf(terms)).toContain("upfront");
    const acceptedRulebookId = z.string().parse(terms.result?.structuredContent?.rulebookId);
    const refused = await tool(clientId, "request_quote", {
      offeringId, brief: "A warm logo for my bakery, ready in a week.", acceptedRulebookId, termsAccepted: false,
    });
    expect(refused.result?.isError).toBe(true);
    expect(await db.select().from(project)).toEqual([]);
  });

  it("lists the tools and keeps the two accepts for the widget", async () => {
    const { clientId } = await setup();
    const listed = await call(mcpRequestHandler(depsFor(clientId), origins), "tools/list", {});
    const visibility = Object.fromEntries((listed.result?.tools ?? []).map((t) => [t.name, t._meta?.ui?.visibility]));
    expect(visibility).toMatchObject({ accept_quote: ["app"], accept_delivery: ["app"] });
    expect(Object.keys(visibility).sort()).toEqual([
      "accept_delivery",
      "accept_quote",
      "get_project",
      "get_request_terms",
      "list_my_projects",
      "reply",
      "request_changes",
      "request_quote",
      "search_offerings",
    ]);
  });

  it("finds the offering and requests it as the signed-in client, from the AI", async () => {
    const { clientId, offeringId } = await setup();
    const found = await tool(clientId, "search_offerings", { query: "logo for a bakery", maxPrice: 400 });
    expect(found.result?.structuredContent?.offerings).toEqual([expect.objectContaining({ id: offeringId })]);
    expect(textOf(found)).toContain("«Logo refresh» by «Walk Crew»");
    const sent = await tool(clientId, "request_quote", { offeringId, brief: "A warm logo for my bakery, ready in a week.", ...await consent(clientId, offeringId) });
    const projectId = z.string().parse(sent.result?.structuredContent?.project?.id);
    expect(await findProjectById(db, projectId)).toMatchObject({ clientHomeSurface: "mcp", status: "quoting" });
    // Seller text reaches the model framed in the text only; structuredContent, which some hosts show the model,
    // carries ids and statuses, and the card reads its words from _meta.
    expect(textOf(sent)).toContain("Request sent to «Walk Crew».");
    for (const r of [found, sent]) {
      expect(JSON.stringify(r.result?.structuredContent)).not.toMatch(/Walk Crew|Logo refresh/);
      expect(JSON.stringify(r.result?._meta?.platform?.card)).toContain("Walk Crew");
    }
  });

  it("limits one client's requests across teams, as the web form does by address", async () => {
    const { organizationId, clientId } = await setup();
    const offerings = await Promise.all(
      Array.from({ length: 7 }, async (_, i) => {
        const team = await seedServicesTeam(db, { organizationId, slug: `team-${i}`, name: `Team ${i}`, status: "active" });
        return seedServicesOffering(db, { teamId: team.id, name: "Logo refresh" });
      }),
    );
    const sent = [];
    for (const offeringId of offerings) {
      for (let n = 0; n < 3; n++) sent.push(await tool(clientId, "request_quote", { offeringId, brief: `A logo for shop ${n}`, ...await consent(clientId, offeringId) }));
    }
    expect(sent.slice(0, 20).filter((r) => r.result?.isError).map(textOf)).toEqual([]);
    expect(sent[20]?.result?.isError).toBe(true);
    expect(textOf(sent[20]!)).toContain("Too many requests");
  });

  it("sums up each freelancer's quote and question, and keeps the confirmations out of the text", async () => {
    const { projectId, teamId, aicha, ben, clientId } = await requested();
    const item = [{ description: "Logo", amountMinor: 15_000, extraDays: 0 }];
    const { quoteId } = await addQuote(db, { teamId, role: "freelancer", actorId: aicha }, { projectId, items: item, deliveryDays: 4 });
    const asked = await postConversationMessage(
      db,
      { kind: "member", actor: { teamId, role: "freelancer", actorId: ben } },
      { projectId, kind: "question", body: "Do you have the 《vector》 file?" },
      "web",
    );
    const shown = await tool(clientId, "get_project", { projectId });
    const text = textOf(shown);
    expect(text).toContain(
      "2 freelancers responded: «Aïcha» quoted $150.00 in 4 days; «Ben» asked «Do you have the \"vector\" file?».",
    );
    expect(text).toContain(`question id ${asked.messageId}`);
    const token = z.string().parse(shown.result?._meta?.platform?.confirmations?.quotes?.[quoteId]);
    expect(text).not.toContain(token);
    expect(shown.result?._meta?.platform?.card?.freelancers).toHaveLength(2);
  });

  it("answers a question masked before acceptance, and accepts a quote only with the card's confirmation", async () => {
    const { projectId, teamId, aicha, ben, clientId } = await requested();
    const item = [{ description: "Logo", amountMinor: 15_000, extraDays: 0 }];
    const { quoteId } = await addQuote(db, { teamId, role: "freelancer", actorId: aicha }, { projectId, items: item, deliveryDays: 4 });
    const asked = await postConversationMessage(
      db,
      { kind: "member", actor: { teamId, role: "freelancer", actorId: ben } },
      { projectId, kind: "question", body: "Your email for the files?" },
      "web",
    );
    const answered = await tool(clientId, "reply", { projectId, questionId: asked.messageId, message: "ann@example.com" });
    expect(textOf(answered)).toContain("emails, phone numbers and messaging links are hidden");
    const [answer] = await db.select().from(conversationMessage).where(eq(conversationMessage.replyToId, asked.messageId));
    expect(answer).toMatchObject({ kind: "answer", surface: "mcp", authorKind: "client" });

    const forged = await tool(clientId, "accept_quote", { projectId, quoteId, confirmation: `${Math.floor(Date.now() / 1000) + 60}.${"0".repeat(64)}` });
    expect(forged.result?.isError).toBe(true);
    expect(textOf(forged)).toContain("Press Accept quote in the project card");
    expect((await findProjectById(db, projectId))?.status).toBe("quoting");

    const card = await tool(clientId, "get_project", { projectId });
    const token = z.string().parse(card.result?._meta?.platform?.confirmations?.quotes?.[quoteId]);
    // A token for one user does not work for another.
    const stranger = await seedUser(db, "Eve");
    const stolen = await tool(stranger, "accept_quote", { projectId, quoteId, confirmation: token });
    expect(textOf(stolen)).toContain("No project with this id belongs to you");
    await addQuote(db, { teamId, role: "freelancer", actorId: ben }, { projectId, items: [{ ...item[0]!, amountMinor: 14_000 }], deliveryDays: 3 });
    const latest = await tool(clientId, "get_project", { projectId });
    const ready = z.string().parse(latest.result?._meta?.platform?.confirmations?.quotes?.[quoteId]);
    await tool(clientId, "accept_quote", { projectId, quoteId, confirmation: ready });
    expect((await findProjectById(db, projectId))?.status).toBe("awaiting_deposit");

    // After the answer and the acceptance, the assistant still reads what was asked, what was paid and who lost.
    const after = textOf(await tool(clientId, "get_project", { projectId }));
    expect(after).toContain(`- Answered question from «Ben» (question id ${asked.messageId}): «Your email for the files?»; the answer: «`);
    expect(after).toContain("«Ben» quoted $140.00 in 3 days, not chosen");
    expect(after).toMatch(/- Payment: deposit \$[\d.,]+, pending\./);
  });

  it("refuses the client once they join the project's team", async () => {
    const { organizationId, projectId, clientId } = await requested();
    await db.insert(member).values({ id: crypto.randomUUID(), organizationId, userId: clientId, role: "admin", createdAt: new Date() });
    const refused = await tool(clientId, "get_project", { projectId });
    expect(textOf(refused)).toBe("You are on this seller's team, so you cannot act as the client of this project.");
  });

  // The api closes each request's database client as soon as the route returns a Response; a tool still
  // running inside a streamed response would lose its connection.
  it("finishes every tool call before the request's database client closes", async () => {
    const { clientId } = await requested();
    const perRequest = createDb({ DATABASE_URL: process.env.TEST_DATABASE_URL ?? "" });
    const response = await mcpRequestHandler(depsFor(clientId, perRequest), origins)(
      new Request("https://api.platform.test/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_my_projects", arguments: {} } }),
      }),
    );
    await perRequest.$client.end();
    const body = await response.text();
    expect(body).toContain("1 project, newest first");
    expect(body).not.toContain("isError");
  });
});
