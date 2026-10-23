import { CURRENCIES } from "@jendal-workspace/core";
import { z } from "zod";

import { MAX_SEARCH_RESULTS, searchOfferings } from "../use-cases/offerings";
import { defineAction } from "./define";

export const offeringSearch = defineAction({
  name: "offering.search",
  kind: "query",
  summary: `Find services sellers on the platform list for AI assistants: up to ${MAX_SEARCH_RESULTS} active offerings whose name, description or seller matches the query, optionally within a budget (minor units, compared with the lowest price) and a number of days (compared with the fastest delivery).`,
  input: z.object({
    query: z.string().trim().max(200),
    budgetMinor: z.int().positive().optional(),
    deadlineDays: z.int().min(1).max(365).optional(),
  }),
  output: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      description: z.string(),
      priceMinMinor: z.int(),
      priceMaxMinor: z.int(),
      daysMin: z.int(),
      daysMax: z.int(),
      intakeQuestions: z.array(z.string()),
      currency: z.enum(CURRENCIES),
      sellerName: z.string(),
      sellerSlug: z.string(),
    }),
  ),
  scope: () => ({}),
  allow: [{ grant: "anyone" }],
  agent: "free",
  run: ({ deps }, input) => searchOfferings(deps.db, input),
});
