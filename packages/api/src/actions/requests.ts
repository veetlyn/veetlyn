import { QUOTE_REQUEST_LIMITS } from "@jendal-workspace/core";
import { z } from "zod";

import { createQuoteRequest } from "../use-cases/requests";
import { defineAction } from "./define";

// Abuse caps only: the use case validates and gives the friendly messages.
export const requestQuoteInput = z.object({
  slug: z.string().min(1).max(63),
  offeringId: z.string().max(64).nullable(),
  name: z.string().max(QUOTE_REQUEST_LIMITS.maxName + 20),
  email: z.string().max(QUOTE_REQUEST_LIMITS.maxEmail),
  description: z.string().max(QUOTE_REQUEST_LIMITS.maxDescription + 100),
  answers: z
    .array(z.object({ question: z.string().max(200), answer: z.string().max(QUOTE_REQUEST_LIMITS.maxAnswer + 100) }))
    .max(10),
  // Honeypot: bots fill the hidden "website" field; a filled field pretends success.
  website: z.string().max(200),
});

export const createRequest = defineAction({
  name: "request.create",
  kind: "action",
  summary: `Ask a seller for a quote: their store slug, a name, an email and a description of ${QUOTE_REQUEST_LIMITS.minDescription} to ${QUOTE_REQUEST_LIMITS.maxDescription} characters, with up to ${QUOTE_REQUEST_LIMITS.maxAnswers} answers to the offering's questions.`,
  input: requestQuoteInput,
  output: z.object({ ok: z.literal(true) }),
  scope: () => ({}),
  allow: [{ grant: "anyone" }],
  run: ({ deps, request }, input) => createQuoteRequest(deps, { ip: request.ip }, input),
});
