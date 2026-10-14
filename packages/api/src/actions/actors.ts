export type Surface = "web" | "api" | "mcp" | "discord" | "slack" | "cron" | "webhook";

export type ClientLinkToken = { projectId: string };

export type Actor =
  | { kind: "user"; userId: string }
  | { kind: "client_link"; token: ClientLinkToken }
  | { kind: "anonymous" }
  | { kind: "system"; job: string }
  | { kind: "agent"; agentId: string; onBehalfOf: Actor };

export type RequestMeta = { requestId: string; ip: string | null };
