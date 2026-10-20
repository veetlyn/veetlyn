import { CONVERSATION_SPACES, MAX_DECLINE_REASON, MAX_MESSAGE_LENGTH } from "@jendal-workspace/core";
import { z } from "zod";

import {
  answerQuestion,
  type ConversationAuthor,
  declineRequest,
  postConversationMessage,
  setMemberDepartments,
  setRequestShortlist,
} from "../use-cases/conversations";
import { type Actor, isClientActor, type Surface } from "./actors";
import { defineAction } from "./define";
import { ActionError } from "./errors";
import type { Scope } from "./perform";
import { projectIdInput } from "./projects";
import { teamActorOf } from "./team-actor";

const spaceOutput = z.object({ messageId: z.uuid(), space: z.enum(CONVERSATION_SPACES) });

// The surfaces a person posts from; scheduled jobs and webhooks never write messages.
function conversationSurface(surface: Surface): "web" | "mcp" | "discord" | "api" {
  switch (surface) {
    case "web":
    case "mcp":
    case "discord":
    case "api":
      return surface;
    case "slack":
    case "cron":
    case "webhook":
      throw new ActionError("forbidden", "Messages cannot be posted from here.");
  }
}

function authorOf(context: { actor: Actor; scope: Scope }): ConversationAuthor {
  const { actor } = context;
  if (isClientActor(actor)) return { kind: "client", contactId: actor.token.contactId };
  return { kind: "member", actor: teamActorOf(context) };
}

const body = z.string().max(MAX_MESSAGE_LENGTH + 100);

export const conversationPost = defineAction({
  name: "conversation.post",
  kind: "action",
  summary: `Post a message (or, for the team, a question for the client) of up to ${MAX_MESSAGE_LENGTH} characters on a project's conversation. Before a quote is accepted, emails, phone numbers and messaging links are hidden from the other side. The client's message reaches the freelancers looking at the request unless it is for the team only.`,
  input: projectIdInput.extend({
    kind: z.enum(["text", "question"]).default("text"),
    body,
    // Staff choose the space; everyone else gets the one their role writes.
    space: z.enum(CONVERSATION_SPACES).optional(),
    teamOnly: z.boolean().default(false),
  }),
  output: spaceOutput,
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "member" }, { grant: "client" }],
  run: (context, input) =>
    postConversationMessage(context.deps.db, authorOf(context), input, conversationSurface(context.surface)),
});

export const conversationAnswer = defineAction({
  name: "conversation.answer",
  kind: "action",
  summary: `Answer one of the team's questions as the project's client, in up to ${MAX_MESSAGE_LENGTH} characters; the answer shows under its question for whoever asked it.`,
  input: projectIdInput.extend({ questionId: z.uuid(), body }),
  output: spaceOutput,
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "client" }],
  run: (context, input) => {
    const author = authorOf(context);
    if (author.kind !== "client") throw new ActionError("internal", "An answer ran without a client.");
    return answerQuestion(context.deps.db, author, input, conversationSurface(context.surface));
  },
});

export const requestDecline = defineAction({
  name: "request.decline",
  kind: "action",
  summary: `Decline a request the team will not quote, with a reason of up to ${MAX_DECLINE_REASON} characters that the client reads; admins and managers only, while the request is being quoted.`,
  input: projectIdInput.extend({ reason: z.string().max(MAX_DECLINE_REASON + 100) }),
  output: z.null(),
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "member" }],
  // A person decides to turn work down.
  agent: "never",
  run: (context, input) => declineRequest(context.deps.db, teamActorOf(context), input),
});

export const requestShortlist = defineAction({
  name: "request.shortlist",
  kind: "action",
  summary: "Choose which team members see an open request, replacing the department rule; an empty list restores it. Admins and managers only.",
  input: projectIdInput.extend({ userIds: z.array(z.string().min(1).max(64)).max(50) }),
  output: z.null(),
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "member" }],
  run: (context, input) => setRequestShortlist(context.deps.db, teamActorOf(context), input),
});

export const memberDepartments = defineAction({
  name: "member.departments",
  kind: "action",
  summary: "Set the departments a team member answers requests for, replacing the ones they had. Team admins only.",
  input: z.object({ userId: z.string().min(1).max(64), departmentIds: z.array(z.uuid()).max(50) }),
  output: z.object({ departmentIds: z.array(z.uuid()) }),
  scope: () => ({}),
  allow: [{ grant: "member" }],
  run: (context, input) => setMemberDepartments(context.deps.db, teamActorOf(context), input),
});
