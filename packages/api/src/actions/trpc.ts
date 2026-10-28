import type { TRPCMutationProcedure, TRPCQueryProcedure } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { linkSecret } from "../client-links";
import type { Context } from "../context";
import { protectedProcedure, publicProcedure } from "../index";
import { servicesTeamProcedure } from "../services-team-procedure";
import { resolveClient } from "../use-cases/clients";
import type { Actor } from "./actors";
import type { ActionDefinition } from "./define";
import { ActionError, toTRPCError } from "./errors";
import { type ActionDeps, logRefusal, perform } from "./perform";

type Definition<Schema extends z.ZodType, Result, Kind extends "action" | "query"> = ActionDefinition<
  z.output<Schema>,
  Result,
  z.input<Schema>
> & { input: Schema; kind: Kind };

type Procedure<Kind extends "action" | "query", Input, Result> = Kind extends "query"
  ? TRPCQueryProcedure<{ input: Input; output: Result; meta: object }>
  : TRPCMutationProcedure<{ input: Input; output: Result; meta: object }>;

// Covers an empty object schema: it infers Record<string, never>, which would turn the slug into never.
type TeamInput<Raw> = string extends keyof Raw ? { teamSlug: string } : { teamSlug: string } & Raw;

type ClientInput<Raw> = Omit<Raw, "projectId"> & { token: string };

type TeamContext = Context & { session: { user: { id: string } }; servicesTeam: { id: string } };

// What the implementations see. Each overload's real types are honest: the runtime branch follows the literal
// `kind` the overload reads, and the chained input parsers merge to the input it declares (checked in
// routers/project-types.test.ts). Every input here is an object that may name a project.
type Loose = { projectId?: string };
type LooseDefinition = ActionDefinition<Loose, unknown, Loose>;

function depsOf(ctx: Context): ActionDeps {
  return {
    db: ctx.db,
    platformName: ctx.platformName,
    files: ctx.files,
    auth: ctx.auth,
    paypal: ctx.paypal,
    payouts: ctx.payouts,
    email: ctx.email,
    now: ctx.now,
    onLogError: ctx.onActionLogError,
  };
}

function requestOf(ctx: Context) {
  return { requestId: crypto.randomUUID(), ip: ctx.headers.get("cf-connecting-ip")?.trim() || null };
}

async function performOnWeb<Input, Result, Raw>(
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
    performOnWeb(ctx, { kind: "user", userId: ctx.session.user.id }, definition, input, ctx.servicesTeam);
  return definition.kind === "query" ? procedure.query(resolve) : procedure.mutation(resolve);
}

const token = z.string().min(1);

const TEAM_MEMBER_REFUSAL = "Team members act from the project page.";

// A team member who opens a client link is refused rather than acting as the client, and the refusal is logged.
async function clientFromToken(
  ctx: Context,
  definition: LooseDefinition,
  link: string,
): Promise<{ actor: Actor; projectId: string }> {
  const userId = ctx.session?.user.id;
  const resolved = await resolveClient(ctx.db, linkSecret(ctx.auth), { token: link, userId });
  if (resolved.ok && resolved.actor.kind === "client_link") {
    return { actor: resolved.actor, projectId: resolved.actor.token.projectId };
  }
  if (!resolved.ok && resolved.reason === "team_member") {
    const actor: Actor = userId ? { kind: "user", userId } : { kind: "anonymous" };
    const request = { deps: depsOf(ctx), actor, surface: "web" as const, request: requestOf(ctx) };
    await logRefusal(request, definition, resolved.projectId, TEAM_MEMBER_REFUSAL);
    throw new TRPCError({ code: "FORBIDDEN", message: TEAM_MEMBER_REFUSAL });
  }
  throw new TRPCError({ code: "NOT_FOUND", message: "This link is not valid." });
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
    const { actor, projectId } = await clientFromToken(ctx, definition, link);
    return performOnWeb(ctx, actor, definition, { ...rest, projectId });
  };
  return definition.kind === "query" ? procedure.query(resolve) : procedure.mutation(resolve);
}

export function publicProcedureFor<Schema extends z.ZodType, Result, Kind extends "action" | "query">(
  definition: Definition<Schema, Result, Kind>,
): Procedure<Kind, z.input<Schema>, Result>;
export function publicProcedureFor(definition: LooseDefinition) {
  const procedure = publicProcedure.input(definition.input);
  const resolve = ({ ctx, input }: { ctx: Context; input: Loose }) =>
    performOnWeb(ctx, { kind: "anonymous" }, definition, input);
  return definition.kind === "query" ? procedure.query(resolve) : procedure.mutation(resolve);
}

export function optionalSessionProcedureFor<Schema extends z.ZodType, Result, Kind extends "action" | "query">(
  definition: Definition<Schema, Result, Kind>,
): Procedure<Kind, z.input<Schema>, Result>;
export function optionalSessionProcedureFor(definition: LooseDefinition) {
  const procedure = publicProcedure.input(definition.input);
  const resolve = ({ ctx, input }: { ctx: Context; input: Loose }) =>
    performOnWeb(ctx, ctx.session ? { kind: "user", userId: ctx.session.user.id } : { kind: "anonymous" }, definition, input);
  return definition.kind === "query" ? procedure.query(resolve) : procedure.mutation(resolve);
}

// For signed-in actions that are not about one team: the session's user is the actor.
export function signedInProcedureFor<Schema extends z.ZodType, Result, Kind extends "action" | "query">(
  definition: Definition<Schema, Result, Kind>,
): Procedure<Kind, z.input<Schema>, Result>;
export function signedInProcedureFor(definition: LooseDefinition) {
  const procedure = protectedProcedure.input(definition.input);
  const resolve = ({ ctx, input }: { ctx: Context & { session: { user: { id: string } } }; input: Loose }) =>
    performOnWeb(ctx, { kind: "user", userId: ctx.session.user.id }, definition, input);
  return definition.kind === "query" ? procedure.query(resolve) : procedure.mutation(resolve);
}
