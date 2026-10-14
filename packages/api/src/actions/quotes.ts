import { MAX_QUOTE_ITEMS } from "@jendal-workspace/core";
import { z } from "zod";

import { acceptAmendment, acceptQuote, addQuote, declineAmendment, proposeAmendment } from "../use-cases/projects";
import { defineAction } from "./define";
import { projectIdInput } from "./projects";
import { teamActorOf } from "./team-actor";

const quoteItemInput = z.object({
  description: z.string().trim().min(1).max(200),
  amountMinor: z.int().positive(),
  extraDays: z.int().min(0).max(365).default(0),
});

export const addQuoteInput = projectIdInput.extend({
  items: z.array(quoteItemInput).min(1).max(MAX_QUOTE_ITEMS),
  deliveryDays: z.int().min(1).max(365),
  freelancerId: z.string().min(1).optional(),
});

export const proposeAmendmentInput = projectIdInput.extend({
  add: z.array(quoteItemInput).max(MAX_QUOTE_ITEMS).default([]),
  removeItemIds: z.array(z.uuid()).max(MAX_QUOTE_ITEMS).default([]),
  note: z.string().max(2000).default(""),
});

export const quoteIdInput = projectIdInput.extend({ quoteId: z.uuid() });
export const amendmentIdInput = projectIdInput.extend({ amendmentId: z.uuid() });

export const quoteCreate = defineAction({
  name: "quote.create",
  kind: "action",
  summary: `Send the client a quote: 1 to ${MAX_QUOTE_ITEMS} items with amounts in minor units and the delivery days (1 to 365).`,
  input: addQuoteInput,
  output: z.object({ quoteId: z.uuid() }),
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "member" }],
  run: (context, input) => addQuote(context.deps.db, teamActorOf(context), input),
});

export const quoteAccept = defineAction({
  name: "quote.accept",
  kind: "action",
  summary: "Accept the project's proposed quote as its client, which opens the deposit payment and returns its id and amount in minor units.",
  input: quoteIdInput,
  output: z.object({ paymentId: z.uuid(), amountMinor: z.int() }),
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "client" }],
  run: ({ deps }, input) => acceptQuote(deps.db, input),
});

export const amendmentPropose = defineAction({
  name: "amendment.propose",
  kind: "action",
  summary: `Propose a change to the accepted quote: up to ${MAX_QUOTE_ITEMS} items to add, up to ${MAX_QUOTE_ITEMS} items to remove, and a note of up to 2000 characters.`,
  input: proposeAmendmentInput,
  output: z.object({ amendmentId: z.uuid() }),
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "member" }],
  run: (context, input) => proposeAmendment(context.deps.db, teamActorOf(context), input),
});

export const amendmentAccept = defineAction({
  name: "amendment.accept",
  kind: "action",
  summary: "Accept a pending amendment as the client; an increase opens a top-up payment, a decrease credits the fee.",
  input: amendmentIdInput,
  output: z.object({ quoteVersion: z.int(), topUpPaymentId: z.uuid().nullable() }),
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "client" }],
  run: ({ deps }, input) => acceptAmendment(deps.db, input),
});

export const amendmentDecline = defineAction({
  name: "amendment.decline",
  kind: "action",
  summary: "Decline a pending amendment as the client; the accepted quote stays as it is.",
  input: amendmentIdInput,
  output: z.null(),
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "client" }],
  run: ({ deps }, input) => declineAmendment(deps.db, input),
});
