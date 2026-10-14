import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { describe, expectTypeOf, it } from "vitest";

import type { projectRouter } from "./project";

// The web client is typed from these; `pnpm check-types` enforces them.
type Router = typeof projectRouter;
type Inputs = inferRouterInputs<Router>;
type Outputs = inferRouterOutputs<Router>;

describe("project router types", () => {
  it("keeps each procedure's query or mutation kind", () => {
    expectTypeOf<Router["list"]["_def"]["type"]>().toEqualTypeOf<"query">();
    expectTypeOf<Router["get"]["_def"]["type"]>().toEqualTypeOf<"query">();
    expectTypeOf<Router["addQuote"]["_def"]["type"]>().toEqualTypeOf<"mutation">();
    expectTypeOf<Router["clientGet"]["_def"]["type"]>().toEqualTypeOf<"query">();
    expectTypeOf<Router["clientDeliveryFileUrl"]["_def"]["type"]>().toEqualTypeOf<"query">();
    expectTypeOf<Router["clientAcceptQuote"]["_def"]["type"]>().toEqualTypeOf<"mutation">();
    expectTypeOf<Router["requestQuote"]["_def"]["type"]>().toEqualTypeOf<"mutation">();
  });

  it("takes the team slug next to a team action's input, defaults optional", () => {
    expectTypeOf<Inputs["list"]>().toEqualTypeOf<{ teamSlug: string }>();
    expectTypeOf<Inputs["get"]>().toEqualTypeOf<{ teamSlug: string } & { projectId: string }>();
    expectTypeOf<Inputs["addQuote"]>().toEqualTypeOf<
      { teamSlug: string } & {
        projectId: string;
        items: { description: string; amountMinor: number; extraDays?: number | undefined }[];
        deliveryDays: number;
        freelancerId?: string | undefined;
      }
    >();
    expectTypeOf<Outputs["addQuote"]>().toEqualTypeOf<{ quoteId: string }>();
  });

  it("takes the client's link in place of the project id", () => {
    expectTypeOf<Inputs["clientDeliveryFileUrl"]>().toEqualTypeOf<{ deliveryId: string } & { token: string }>();
    expectTypeOf<Outputs["clientDeliveryFileUrl"]>().toEqualTypeOf<{ url: string }>();
    expectTypeOf<Inputs["clientAcceptQuote"]>().toEqualTypeOf<{ quoteId: string } & { token: string }>();
    expectTypeOf<Outputs["clientAcceptQuote"]>().toEqualTypeOf<{ paymentId: string; amountMinor: number }>();
  });

  it("takes the public request form as it is", () => {
    expectTypeOf<Inputs["requestQuote"]>().toEqualTypeOf<{
      slug: string;
      offeringId: string | null;
      name: string;
      email: string;
      description: string;
      answers: { question: string; answer: string }[];
      website: string;
    }>();
    expectTypeOf<Outputs["requestQuote"]>().toEqualTypeOf<{ ok: true }>();
  });
});
