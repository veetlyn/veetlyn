import { createFakeFileStore, HIDDEN_CONTACT, type QuotingMode } from "@jendal-workspace/core";
import { primaryContactFor } from "@jendal-workspace/db/repositories/contacts";
import { findProjectById } from "@jendal-workspace/db/repositories/projects";
import { conversationMessage, memberDepartment } from "@jendal-workspace/db/schema/conversations";
import { outbox } from "@jendal-workspace/db/schema/outbox";
import { project } from "@jendal-workspace/db/schema/projects";
import { servicesDepartment } from "@jendal-workspace/db/schema/services-catalog";
import { servicesTeamSettings } from "@jendal-workspace/db/schema/services-teams";
import {
  createTestDb,
  hasTestDatabase,
  seedProject,
  seedServicesOffering,
  seedServicesTeamMember,
  seedServicesTeamWithAdmin,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  answerQuestion,
  type ConversationAuthor,
  conversationFor,
  declineRequest,
  postConversationMessage,
  setMemberDepartments,
  setRequestShortlist,
} from "./conversations";
import { acceptQuote, addQuote, type ProjectActor, requestChanges, submitDelivery } from "./projects";

describe.skipIf(!hasTestDatabase)("conversations", () => {
  const db = createTestDb();
  const files = createFakeFileStore();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function setup(mode: QuotingMode = "open") {
    const { organizationId, teamId, userId } = await seedServicesTeamWithAdmin(db);
    await db.update(servicesTeamSettings).set({ quotingMode: mode }).where(eq(servicesTeamSettings.teamId, teamId));
    const [design] = await db.insert(servicesDepartment).values({ teamId, name: "Design" }).returning();
    const [video] = await db.insert(servicesDepartment).values({ teamId, name: "Video" }).returning();
    if (!design || !video) throw new Error("no departments");
    const offeringId = await seedServicesOffering(db, { teamId, departmentId: design.id });
    const projectId = await seedProject(db, { teamId, title: "Logo", source: "web" });
    await db.update(project).set({ offeringId }).where(eq(project.id, projectId));
    const member = async (name: string, departmentId?: string): Promise<ProjectActor> => {
      const id = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer", name });
      if (departmentId) await db.insert(memberDepartment).values({ teamId, userId: id, departmentId });
      return { teamId, role: "freelancer", actorId: id };
    };
    const aicha = await member("Aïcha", design.id);
    const ben = await member("Ben", design.id);
    const olu = await member("Olu", video.id);
    const primary = await primaryContactFor(db, projectId);
    if (!primary) throw new Error("no contact");
    return {
      teamId,
      projectId,
      admin: { teamId, role: "admin", actorId: userId } satisfies ProjectActor,
      aicha,
      ben,
      olu,
      client: { kind: "client", contactId: primary.contactId } satisfies ConversationAuthor,
      design: design.id,
      video: video.id,
    };
  }

  const as = (actor: ProjectActor): ConversationAuthor => ({ kind: "member", actor });

  async function messagesOf(projectId: string) {
    return db
      .select()
      .from(conversationMessage)
      .where(eq(conversationMessage.projectId, projectId))
      .orderBy(asc(conversationMessage.createdAt));
  }

  async function quote(actor: ProjectActor, projectId: string, amountMinor = 15_000) {
    return addQuote(db, actor, { projectId, items: [{ description: "Logo", amountMinor, extraDays: 0 }], deliveryDays: 4 });
  }

  it("lets a department freelancer ask the client, and keeps freelancers of other departments out", async () => {
    const { projectId, aicha, olu } = await setup();
    const asked = await postConversationMessage(
      db,
      as(aicha),
      { projectId, kind: "question", body: "Do you have the vector file?" },
      "web",
    );
    expect(asked.space).toBe("request");
    await expect(
      postConversationMessage(db, as(olu), { projectId, kind: "text", body: "Hello" }, "web"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const events = await db.select().from(outbox).where(eq(outbox.projectId, projectId));
    expect(events.map((e) => e.type)).toContain("message.posted");
  });

  it("relays the client's reply to the freelancers masked, keeps the original, and holds team-only notes back", async () => {
    const { projectId, client, aicha, admin } = await setup();
    const reply = await postConversationMessage(
      db,
      client,
      { projectId, kind: "text", body: "Mail me at ann@example.com, files at drive.google.com/x" },
      "mcp",
    );
    const note = await postConversationMessage(db, client, { projectId, kind: "text", body: "Budget is tight", teamOnly: true }, "web");
    expect([reply.space, note.space]).toEqual(["request", "project"]);
    const [stored] = await messagesOf(projectId);
    expect(stored).toMatchObject({
      body: "Mail me at ann@example.com, files at drive.google.com/x",
      shownBody: `Mail me at ${HIDDEN_CONTACT}, files at drive.google.com/x`,
      surface: "mcp",
    });
    const row = await findProjectById(db, projectId);
    if (!row) throw new Error("no project");
    const forFreelancer = await conversationFor(db, as(aicha), row);
    expect(forFreelancer.messages.map((m) => [m.authorName, m.body, m.originalBody])).toEqual([
      ["Client", `Mail me at ${HIDDEN_CONTACT}, files at drive.google.com/x`, null],
    ]);
    const forAdmin = await conversationFor(db, as(admin), row);
    expect(forAdmin.messages[0]?.originalBody).toBe("Mail me at ann@example.com, files at drive.google.com/x");
    expect(forAdmin.messages).toHaveLength(2);
  });

  it("puts the client's answer under its question, and refuses an answer to a message that is not a question", async () => {
    const { projectId, client, aicha } = await setup();
    const question = await postConversationMessage(db, as(aicha), { projectId, kind: "question", body: "Which colours?" }, "web");
    const text = await postConversationMessage(db, as(aicha), { projectId, kind: "text", body: "Starting soon" }, "web");
    const answer = await answerQuestion(db, client, { projectId, questionId: question.messageId, body: "Green" }, "mcp");
    const stored = (await messagesOf(projectId)).find((m) => m.id === answer.messageId);
    expect(stored).toMatchObject({ kind: "answer", replyToId: question.messageId, space: "request", authorKind: "client" });
    await expect(
      answerQuestion(db, client, { projectId, questionId: text.messageId, body: "?" }, "web"),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("declines only with a reason, by staff, and then closes the request to messages and quotes", async () => {
    const { projectId, admin, aicha, client } = await setup();
    await expect(declineRequest(db, admin, { projectId, reason: "  " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(declineRequest(db, aicha, { projectId, reason: "Busy" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await declineRequest(db, admin, { projectId, reason: "We are fully booked until December." });
    const row = await findProjectById(db, projectId);
    expect(row).toMatchObject({ status: "declined", declinedReason: "We are fully booked until December." });
    expect(row?.declinedAt).toBeInstanceOf(Date);
    expect(await messagesOf(projectId)).toEqual([
      expect.objectContaining({
        kind: "event",
        space: "project",
        body: "The team declined this request: We are fully booked until December.",
      }),
    ]);
    await expect(
      postConversationMessage(db, client, { projectId, kind: "text", body: "Why?" }, "web"),
    ).rejects.toThrow("The team declined this request, so it takes no new messages.");
    await expect(quote(aicha, projectId)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("closes the request to the other freelancers at acceptance and lets the winner write unmasked", async () => {
    const { projectId, aicha, ben } = await setup();
    const { quoteId } = await quote(aicha, projectId);
    await quote(ben, projectId, 12_000);
    await acceptQuote(db, { projectId, quoteId });
    await expect(
      postConversationMessage(db, as(ben), { projectId, kind: "text", body: "Still here" }, "web"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const posted = await postConversationMessage(db, as(aicha), { projectId, kind: "text", body: "Call +221 77 123 45 67" }, "web");
    expect(posted.space).toBe("project");
    const events = (await messagesOf(projectId)).filter((m) => m.kind === "event");
    expect(events.map((m) => [m.space, m.body])).toEqual([
      ["request", "Aïcha sent a quote: $150.00, delivered in 4 days."],
      ["request", "Ben sent a quote: $120.00, delivered in 4 days."],
      ["project", "The client accepted Aïcha's quote of $150.00."],
    ]);
    const mine = (await messagesOf(projectId)).find((m) => m.id === posted.messageId);
    expect(mine?.shownBody).toBe("Call +221 77 123 45 67");
  });

  it("records the delivery and the client's change request on the project timeline", async () => {
    const { projectId, aicha } = await setup();
    const { quoteId } = await quote(aicha, projectId);
    await acceptQuote(db, { projectId, quoteId });
    await db.update(project).set({ status: "in_progress" }).where(eq(project.id, projectId));
    const { deliveryId } = await submitDelivery(db, files, aicha, { projectId, note: "Here it is", link: "" });
    await requestChanges(db, { projectId, deliveryId, note: "Bigger, please" });
    const events = (await messagesOf(projectId)).filter((m) => m.refType === "delivery");
    expect(events.map((m) => m.body)).toEqual(["Aïcha delivered the work.", "The client asked for changes to the delivery."]);
  });

  it("lets a staff shortlist replace the department rule and an empty one restore it", async () => {
    const { projectId, admin, ben, olu } = await setup();
    await setRequestShortlist(db, admin, { projectId, userIds: [olu.actorId] });
    await postConversationMessage(db, as(olu), { projectId, kind: "text", body: "I can do it" }, "web");
    await expect(
      postConversationMessage(db, as(ben), { projectId, kind: "text", body: "Me too" }, "web"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setRequestShortlist(db, ben, { projectId, userIds: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await setRequestShortlist(db, admin, { projectId, userIds: [] });
    await postConversationMessage(db, as(ben), { projectId, kind: "text", body: "Me too" }, "web");
  });

  it("lets team admins set a member's departments, replacing the old ones", async () => {
    const { admin, aicha, olu, design, video } = await setup();
    await expect(setMemberDepartments(db, admin, { userId: olu.actorId, departmentIds: [design, video] })).resolves.toEqual({
      departmentIds: expect.arrayContaining([design, video]),
    });
    await setMemberDepartments(db, admin, { userId: olu.actorId, departmentIds: [design] });
    const rows = await db.select().from(memberDepartment).where(eq(memberDepartment.userId, olu.actorId));
    expect(rows.map((r) => r.departmentId)).toEqual([design]);
    await expect(
      setMemberDepartments(db, aicha, { userId: olu.actorId, departmentIds: [] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      setMemberDepartments(db, admin, { userId: olu.actorId, departmentIds: [crypto.randomUUID()] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
