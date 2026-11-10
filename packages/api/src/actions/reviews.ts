import { MAX_REVIEW_BODY } from "@jendal-workspace/core";
import { z } from "zod";

import { addPortfolioItem, rateClient, removePortfolioItem, submitReview } from "../use-cases/reviews";
import { defineAction } from "./define";
import { projectIdInput } from "./projects";
import { teamActorOf } from "./team-actor";
import { isClientActor } from "./actors";
import { ActionError } from "./errors";

const stars = z.int().min(1).max(5);

// P design §1. Never for the dash assistant: a review is the client's own words, so only the client or the
// assistant they talk to on their behalf (the plugin) posts it.
export const reviewSubmit = defineAction({
  name: "review.submit",
  kind: "action",
  summary: `Rate the seller of a completed project as its client, 1 to 5 stars, with an optional public review of up to ${MAX_REVIEW_BODY} characters. One review per project, editable for 30 days. Post only the stars and words the client chose.`,
  input: projectIdInput.extend({ rating: stars, body: z.string().max(5_000).default("") }),
  output: z.object({ rating: z.int(), body: z.string() }),
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "client" }],
  agent: "never",
  run: ({ deps, actor }, input) => {
    if (!isClientActor(actor)) throw new ActionError("forbidden", "Only the project's client can review it.");
    return submitReview(deps.db, { ...input, contactId: actor.token.contactId });
  },
});

export const clientRatingSet = defineAction({
  name: "client_rating.set",
  kind: "action",
  summary: "Rate the client of a completed project, 1 to 5 stars, with an optional private note; admins only, seen only by the team's staff.",
  input: projectIdInput.extend({ rating: stars, note: z.string().max(2_000).default("") }),
  output: z.null(),
  scope: (input) => ({ projectId: input.projectId }),
  allow: [{ grant: "member" }],
  agent: "never",
  run: async (context, input) => {
    await rateClient(context.deps.db, teamActorOf(context), input);
    return null;
  },
});

export const portfolioAdd = defineAction({
  name: "portfolio.add",
  kind: "action",
  summary: "Add a link to past work to the seller page's portfolio: a title, an https link and a short description; admins only.",
  input: z.object({ title: z.string().max(1_000), url: z.string().max(2_000), description: z.string().max(5_000).default("") }),
  output: z.object({ id: z.string() }),
  scope: () => ({}),
  allow: [{ grant: "member" }],
  run: (context, input) => addPortfolioItem(context.deps.db, teamActorOf(context), input),
});

export const portfolioRemove = defineAction({
  name: "portfolio.remove",
  kind: "action",
  summary: "Remove an item from the seller page's portfolio; admins only.",
  input: z.object({ id: z.string().min(1).max(64) }),
  output: z.null(),
  scope: () => ({}),
  allow: [{ grant: "member" }],
  run: async (context, input) => {
    await removePortfolioItem(context.deps.db, teamActorOf(context), input);
    return null;
  },
});

export const REVIEW_ACTIONS = [reviewSubmit, clientRatingSet, portfolioAdd, portfolioRemove] as const;
