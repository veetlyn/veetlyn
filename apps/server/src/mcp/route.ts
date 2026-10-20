import { mcpResourceFor } from "@jendal-workspace/auth";
import { requireMcpAuth } from "@better-auth/mcp";
import { createMcpHandler } from "@modelcontextprotocol/server";

import { BRIDGE_SOURCE, BRIDGE_VERSION } from "./bridge.generated";
import { buildServer, type WidgetOrigins } from "./server";
import type { McpDeps } from "./tools";

export const BRIDGE_PATH = `/mcp/bridge-${BRIDGE_VERSION}.js`;

// The api middleware closes the per-request database client once the handler returns a Response; a streamed
// (SSE) response would still be running tools then. Buffering keeps every tool call inside the request.
export function mcpRequestHandler(deps: McpDeps, origins: WidgetOrigins): (request: Request) => Promise<Response> {
  // Both protocol eras on one endpoint: Claude sends initialize (2025-11-25), ChatGPT the stateless 2026-07-28.
  const handler = createMcpHandler(() => buildServer(deps, origins), { legacy: "stateless" });
  return async (request) => {
    const response = await handler.fetch(request);
    const body = await response.arrayBuffer();
    return new Response(body, { status: response.status, headers: response.headers });
  };
}

export function createMcpRoute(
  base: Omit<McpDeps, "userId">,
  input: { authUrl: string; origins: WidgetOrigins },
): (request: Request) => Promise<Response> {
  return requireMcpAuth(
    base.auth,
    async (request, claims) => {
      const userId = claims.sub;
      if (!userId) return new Response("The access token names no user.", { status: 401 });
      base.log.set({ mcp: { userId, clientId: claims.azp ?? claims.client_id } });
      return mcpRequestHandler({ ...base, userId }, input.origins)(request);
    },
    { resource: mcpResourceFor(input.authUrl) },
  );
}

// The widget imports the MCP Apps bridge from here: hosts load it in a sandboxed frame whose origin is opaque,
// so the module needs an open CORS header.
export function bridgeResponse(): Response {
  return new Response(BRIDGE_SOURCE, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
      "access-control-allow-origin": "*",
    },
  });
}

export function widgetOriginsFor(input: { authUrl: string; storeDomain: string }): WidgetOrigins {
  return { api: new URL(mcpResourceFor(input.authUrl)).origin, storeWildcard: `https://*.${input.storeDomain}` };
}

