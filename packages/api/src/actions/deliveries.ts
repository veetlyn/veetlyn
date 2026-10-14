import { formatBytes, MAX_FILE_BYTES } from "@jendal-workspace/core";
import { z } from "zod";

import { teamDeliveryFileUrl } from "../use-cases/project-views";
import {
  acceptDelivery,
  deliveryFileUrl,
  requestChanges,
  startDeliveryUpload,
  submitDelivery,
} from "../use-cases/projects";
import { defineAction } from "./define";
import { projectIdInput } from "./projects";
import { teamActorOf } from "./team-actor";

export const uploadStartInput = projectIdInput.extend({
  fileName: z.string().min(1).max(1_000),
  sizeBytes: z.int().nonnegative(),
});

// Abuse caps only: the use case trims and gives the friendly length messages.
export const submitDeliveryInput = projectIdInput.extend({
  note: z.string().max(10_000).default(""),
  link: z.string().max(10_000).default(""),
  fileUploadId: z.uuid().optional(),
});

export const deliveryIdInput = projectIdInput.extend({ deliveryId: z.uuid() });

export const requestChangesInput = deliveryIdInput.extend({ note: z.string().max(10_000) });

export const deliveryUploadStart = defineAction({
  name: "delivery.upload_start",
  kind: "action",
  summary: `Get a 15-minute upload link for a delivery file of up to ${formatBytes(MAX_FILE_BYTES)}; at most 20 uploads per 10 minutes.`,
  input: uploadStartInput,
  output: z.object({ uploadId: z.uuid(), url: z.url(), headers: z.record(z.string(), z.string()) }),
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "member" }],
  run: (context, input) => startDeliveryUpload(context.deps.db, context.deps.files, teamActorOf(context), input),
});

export const deliverySubmit = defineAction({
  name: "delivery.submit",
  kind: "action",
  summary:
    "Submit the work to the client: at least one of a note of up to 5000 characters, an https link of up to 2000, or an uploaded file.",
  input: submitDeliveryInput,
  output: z.object({ deliveryId: z.uuid() }),
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "member" }],
  run: (context, input) => submitDelivery(context.deps.db, context.deps.files, teamActorOf(context), input),
});

export const deliveryRequestChanges = defineAction({
  name: "delivery.request_changes",
  kind: "action",
  summary: "Send the delivery back as the client with a note of up to 5000 characters saying what should change.",
  input: requestChangesInput,
  output: z.null(),
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "client" }],
  run: ({ deps }, input) => requestChanges(deps.db, input),
});

export const deliveryAccept = defineAction({
  name: "delivery.accept",
  kind: "action",
  summary: "Accept the delivery as the client, which fixes the final price and opens the balance payment if any is due.",
  input: deliveryIdInput,
  output: z.object({ status: z.enum(["awaiting_balance", "completed"]), balancePaymentId: z.uuid().nullable() }),
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "client" }],
  run: ({ deps }, input) => acceptDelivery(deps.db, input),
});

export const deliveryFile = defineAction({
  name: "delivery.file_url",
  kind: "query",
  summary: "Get a download link for a delivery's file that lasts 5 minutes, for the team or the project's client.",
  input: deliveryIdInput,
  output: z.object({ url: z.url() }),
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "member" }, { grant: "client" }],
  run: (context, input) =>
    context.actor.kind === "client_link"
      ? deliveryFileUrl(context.deps.db, context.deps.files, input)
      : teamDeliveryFileUrl(context.deps, teamActorOf(context), input),
});
