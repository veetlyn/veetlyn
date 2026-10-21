export type Surface = "web" | "api" | "mcp" | "discord" | "slack" | "cron" | "webhook";

export type ClientLinkToken = { projectId: string; contactId: string };

export type Actor =
  | { kind: "user"; userId: string }
  | { kind: "client_link"; token: ClientLinkToken }
  // A signed-in user an adapter resolved to an attached contact of one project with resolveClient (A2 §5.4):
  // never a member of the project's team.
  | { kind: "client_account"; userId: string; token: ClientLinkToken }
  | { kind: "anonymous" }
  | { kind: "system"; job: string }
  | { kind: "agent"; agentId: string; onBehalfOf: Actor };

export type RequestMeta = { requestId: string; ip: string | null };

export type ClientActor = Extract<Actor, { kind: "client_link" | "client_account" }>;

export function isClientActor(actor: Actor): actor is ClientActor {
  return actor.kind === "client_link" || actor.kind === "client_account";
}
