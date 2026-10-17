import { z } from "zod";

import { addProjectClient, emailClientLink, reissueClientLink, removeProjectClient } from "../use-cases/clients";
import { getClientPreview } from "../use-cases/project-views";
import { defineAction } from "./define";
import { projectIdInput } from "./projects";
import { teamActorOf } from "./team-actor";

const contactInput = projectIdInput.extend({ contactId: z.uuid() });
const sendLinkInput = contactInput.extend({ email: z.string().max(200).optional() });
const sentOutput = z.object({ sentTo: z.string() });

export const projectClientAdd = defineAction({
  name: "project.client.add",
  kind: "action",
  summary: "Add a client to the project by email, with an optional name; the address stays unverified until the client opens a link sent to it. Admins and managers only.",
  input: projectIdInput.extend({ email: z.string().max(200), name: z.string().max(200).default("") }),
  output: z.object({ contactId: z.uuid() }),
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "member" }],
  run: (context, input) => addProjectClient(context.deps.db, teamActorOf(context), input),
});

export const projectClientRemove = defineAction({
  name: "project.client.remove",
  kind: "action",
  summary: "Remove a client from the project, which stops their links working; the last client cannot be removed. Admins and managers only.",
  input: contactInput,
  output: z.null(),
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "member" }],
  run: (context, input) => removeProjectClient(context.deps.db, teamActorOf(context), input),
});

export const projectClientLinkEmail = defineAction({
  name: "project.client_link.email",
  kind: "action",
  summary: "Email a client their link to the project page, at one of their email addresses. Admins and managers only.",
  input: sendLinkInput,
  output: sentOutput,
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "member" }],
  run: (context, input) => emailClientLink(context.deps, teamActorOf(context), input),
});

export const projectClientLinkReissue = defineAction({
  name: "project.client_link.reissue",
  kind: "action",
  summary: "Replace a client's link to the project page: every link they were sent stops working and the new one is emailed. Admins and managers only.",
  input: sendLinkInput,
  output: sentOutput,
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "member" }],
  run: (context, input) => reissueClientLink(context.deps, teamActorOf(context), input),
});

export const projectClientPreview = defineAction({
  name: "project.client_preview",
  kind: "query",
  summary: "Show the team what the client's project page shows, read-only and without any link to act through.",
  input: projectIdInput,
  output: null,
  surfaces: ["web"],
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "member" }],
  run: (context, input) => getClientPreview(context.deps, teamActorOf(context), input.projectId),
});
