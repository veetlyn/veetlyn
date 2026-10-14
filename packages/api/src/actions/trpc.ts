import type { TRPCMutationProcedure, TRPCQueryProcedure } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { linkSecret, verifyClientLink } from "../client-links";
import type { Context } from "../context";
import { publicProcedure } from "../index";
import { servicesTeamProcedure } from "../services-team-procedure";
import type { Actor } from "./actors";
import type { ActionDefinition } from "./define";
import { ActionError, toTRPCError } from "./errors";
import { type ActionDeps, perform } from "./perform";

type Definition<Schema extends z.ZodType, Result, Kind extends "action" | "query"> = ActionDefinition<
  z.output<Schema>,
  Result,
  z.input<Schema>
> & { input: Schema; kind: Kind };

type Procedure<Kind extends "action" | "query", Input, Result> = Kind extends "query"
  ? TRPCQueryProcedure<{ input: Input; output: Result; meta: object }>
  : TRPCMutationProcedure<{ input: Input; output: Result; meta: object }>;

// An empty object schema infers Record<string, never>, which would turn the slug into never.
type TeamInput<Raw> = string extends keyof Raw ? { teamSlug: string } : { teamSlug: string } & Raw;

type ClientInput<Raw> = Omit<Raw, "projectId"> & { token: string };

type TeamContext = Context & { session: { user: { id: string } }; servicesTeam: { id: string } };

// What the implementations see: each overload carries the definition's real types, and every input here is an
// object that may name a project.
type Loose = { projectId?: string };
type LooseDefinition = ActionDefinition<Loose, unknown, Loose>;

function depsOf(ctx: Context): ActionDeps {
  return { db: ctx.db, files: ctx.files, auth: ctx.auth, paypal: ctx.paypal, email: ctx.email, now: ctx.now };
}

function requestOf(ctx: Context) {
  return { requestId: crypto.randomUUID(), ip: ctx.headers.get("cf-connecting-ip")?.trim() || null };
}

async function run<Input, Result, Raw>(
  ctx: Context,
  actor: Actor,
  definition: ActionDefinition<Input, Result, Raw>,
  input: Raw,
  team?: { id: string },
): Promise<Result> {
  try {
    const request = { deps: depsOf(ctx), actor, surface: "web" as const, request: requestOf(ctx), team };
    return await perform(request, definition, input);
  } catch (error) {
    throw error instanceof ActionError ? toTRPCError(error) : error;
  }
}

// The definition's input sits next to the team slug; perform's parse drops the slug.
export function teamProcedureFor<Schema extends z.ZodType, Result, Kind extends "action" | "query">(
  definition: Definition<Schema, Result, Kind>,
): Procedure<Kind, TeamInput<z.input<Schema>>, Result>;
export function teamProcedureFor(definition: LooseDefinition) {
  const procedure = servicesTeamProcedure.input(definition.input);
  const resolve = ({ ctx, input }: { ctx: TeamContext; input: Loose }) =>
    run(ctx, { kind: "user", userId: ctx.session.user.id }, definition, input, ctx.servicesTeam);
  return definition.kind === "query" ? procedure.query(resolve) : procedure.mutation(resolve);
}

const token = z.string().min(1);

async function projectIdFromToken(ctx: Context, link: string): Promise<string> {
  const projectId = await verifyClientLink(linkSecret(ctx.auth), link);
  if (!projectId) throw new TRPCError({ code: "NOT_FOUND", message: "This link is not valid." });
  return projectId;
}

// The client sends the link it holds instead of the project id the link names.
export function clientProcedureFor<
  Schema extends z.ZodObject<{ projectId: z.ZodType<string> }>,
  Result,
  Kind extends "action" | "query",
>(definition: Definition<Schema, Result, Kind>): Procedure<Kind, ClientInput<z.input<Schema>>, Result>;
export function clientProcedureFor(
  definition: LooseDefinition & { input: z.ZodObject<{ projectId: z.ZodType<string> }> },
) {
  const procedure = publicProcedure.input(definition.input.omit({ projectId: true }).extend({ token }));
  const resolve = async ({ ctx, input }: { ctx: Context; input: { token: string } }) => {
    // The rest holds the definition's other fields, which the omitted schema typed loosely.
    const { token: link, ...rest } = input;
    const projectId = await projectIdFromToken(ctx, link);
    return run(ctx, { kind: "client_link", token: { projectId } }, definition, { ...rest, projectId });
  };
  return definition.kind === "query" ? procedure.query(resolve) : procedure.mutation(resolve);
}

export function publicProcedureFor<Schema extends z.ZodType, Result, Kind extends "action" | "query">(
  definition: Definition<Schema, Result, Kind>,
): Procedure<Kind, z.input<Schema>, Result>;
export function publicProcedureFor(definition: LooseDefinition) {
  const procedure = publicProcedure.input(definition.input);
  const resolve = ({ ctx, input }: { ctx: Context; input: Loose }) =>
    run(ctx, { kind: "anonymous" }, definition, input);
  return definition.kind === "query" ? procedure.query(resolve) : procedure.mutation(resolve);
}
