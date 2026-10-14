import { mcpResourceFor } from "@jendal-workspace/auth";
import { getClientProjectView } from "@jendal-workspace/api/use-cases/project-views";
import type { Database } from "@jendal-workspace/db";
import { findProjectWithPendingPayment, listPublishedOfferings } from "@jendal-workspace/db/repositories/mcp-spike";
import { requireMcpAuth } from "@better-auth/mcp";
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type { RequestLogger } from "evlog";
import { z } from "zod";

import type { Auth } from "@jendal-workspace/auth";

const BRIDGE_URL = "https://unpkg.com/@modelcontextprotocol/ext-apps@2.0.3/dist/src/app-with-deps.js";
const UI_META = { ui: { csp: { resourceDomains: ["https://unpkg.com"] } } };
const SPIKE_TEAM_SLUG = "walk-crew";

type SpikeDeps = { db: Database; auth: Auth; siteOrigin: string; log: RequestLogger; userId: string };

const page = (title: string, body: string, script: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font: 14px/1.4 system-ui, sans-serif; margin: 0; padding: 12px; color: #111; background: #fff; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; }
  .muted { color: #666; font-size: 12px; }
  .tag { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 99px; background: #eef; margin-left: 6px; }
  button { font: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid #333; background: #111; color: #fff; cursor: pointer; margin-right: 6px; }
  button.secondary { background: #fff; color: #111; }
  #status { margin-top: 8px; font-size: 12px; }
</style></head>
<body><h3 style="margin:0 0 8px">${title}</h3>${body}
<script type="module">
import { App } from "${BRIDGE_URL}";
const app = new App({ name: "payleor-spike", version: "0.0.1" }, {}, { autoResize: true });
const $ = (id) => document.getElementById(id);
const money = (minor, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
${script}
await app.connect();
</script></body></html>`;

const OFFERINGS_HTML = page(
  "Payleor offerings",
  `<div id="list" class="muted">Waiting for results…</div>`,
  `app.ontoolresult = ({ structuredContent }) => {
  const offerings = structuredContent?.offerings ?? [];
  $("list").innerHTML = offerings.length ? "" : "No offerings match.";
  for (const o of offerings) {
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = "<strong></strong><span class='tag'></span><div class='muted'></div><div></div>";
    el.children[0].textContent = o.name;
    el.children[1].textContent = o.fulfilment;
    el.children[2].textContent = o.seller + " · " + o.days;
    el.children[3].textContent = money(o.priceMinMinor) + " – " + money(o.priceMaxMinor);
    $("list").append(el);
  }
};`,
);

const QUOTE_HTML = page(
  "Your quote",
  `<div id="quote" class="card muted">Waiting for the quote…</div>
<button id="pay" disabled>Pay with PayPal</button><button id="accept" class="secondary" disabled>Accept (test)</button>
<div id="status" class="muted"></div>`,
  `let current = null;
app.ontoolresult = ({ structuredContent }) => {
  current = structuredContent;
  if (!current?.projectId) { $("quote").textContent = "No quote found."; return; }
  $("quote").classList.remove("muted");
  $("quote").textContent = current.title + ": " + money(current.amountMinor, current.currency) + " in " + current.deliveryDays + " days (" + current.quoteStatus + ")";
  $("pay").disabled = !current.payUrl;
  $("accept").disabled = false;
};
$("pay").onclick = async () => {
  const result = await app.openLink({ url: current.payUrl });
  $("status").textContent = result?.isError ? "The host refused to open the link." : "Opened the pay page.";
};
$("accept").onclick = async () => {
  try {
    const result = await app.callServerTool({ name: "accept_quote_spike", arguments: { projectId: current.projectId } });
    $("status").textContent = "accept_quote_spike answered: " + JSON.stringify(result.structuredContent ?? result.content);
  } catch (error) {
    $("status").textContent = "accept_quote_spike failed: " + String(error);
  }
};`,
);

function buildServer(deps: SpikeDeps): McpServer {
  const server = new McpServer({ name: "payleor", version: "0.0.1" });

  registerAppResource(
    server,
    "Offerings",
    "ui://payleor/offerings",
    { mimeType: RESOURCE_MIME_TYPE },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: OFFERINGS_HTML, _meta: UI_META }],
    }),
  );
  registerAppResource(
    server,
    "Quote",
    "ui://payleor/quote",
    { mimeType: RESOURCE_MIME_TYPE },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: QUOTE_HTML, _meta: UI_META }],
    }),
  );

  registerAppTool(
    server,
    "find_offerings",
    {
      title: "Find offerings",
      description:
        "Search the services that Payleor sellers offer (for example a logo design). Returns each offering's seller, price range and usual days.",
      inputSchema: { query: z.string().describe("What the client needs"), maxPrice: z.number().optional() },
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: "ui://payleor/offerings" } },
    },
    async ({ query, maxPrice }) => {
      deps.log.set({ mcp: { tool: "find_offerings", query, maxPrice } });
      const rows = await listPublishedOfferings(deps.db, {
        maxPriceMinor: maxPrice === undefined ? undefined : Math.round(maxPrice * 100),
      });
      const offerings = rows.map((r) => ({
        ...r,
        days: r.daysMin === r.daysMax ? `${r.daysMin} days` : `${r.daysMin}–${r.daysMax} days`,
        fulfilment: "By people",
      }));
      return {
        content: [
          {
            type: "text",
            text: offerings.length
              ? offerings.map((o) => `${o.name} by ${o.seller}: $${o.priceMinMinor / 100}–$${o.priceMaxMinor / 100}, ${o.days}`).join("\n")
              : "No offerings match.",
          },
        ],
        structuredContent: { offerings },
      };
    },
  );

  registerAppTool(
    server,
    "show_quote",
    {
      title: "Show quote",
      description: "Show the latest quote of a Payleor project and its pay link. Without a project id, shows the demo project.",
      inputSchema: { projectId: z.string().optional() },
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: "ui://payleor/quote" } },
    },
    async ({ projectId }) => {
      deps.log.set({ mcp: { tool: "show_quote", projectId } });
      const row = await findProjectWithPendingPayment(deps.db, { teamSlug: SPIKE_TEAM_SLUG, projectId });
      if (!row) return { content: [{ type: "text", text: "No project with a pending payment." }], structuredContent: {} };
      const view = await getClientProjectView({ db: deps.db, auth: deps.auth }, row).catch((error: unknown) => {
        deps.log.error(error instanceof Error ? error : new Error(String(error)), {
          cause: error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined,
        });
        throw error;
      });
      const quote = view.quotes.at(-1);
      const pending = view.payments.find((p) => p.payPath !== null);
      const result = {
        projectId: view.project.id,
        title: view.project.title,
        currency: view.project.currency,
        amountMinor: quote?.amountMinor ?? 0,
        deliveryDays: quote?.deliveryDays ?? 0,
        quoteStatus: quote?.status ?? "none",
        paymentKind: pending?.kind ?? null,
        paymentAmountMinor: pending?.amountMinor ?? null,
        payUrl: pending?.payPath ? `${deps.siteOrigin}${pending.payPath}` : null,
      };
      return {
        content: [
          {
            type: "text",
            text: `${result.title}: quote ${result.quoteStatus}, $${result.amountMinor / 100} in ${result.deliveryDays} days. The client pays in the widget; do not share the pay link.`,
          },
        ],
        structuredContent: result,
      };
    },
  );

  registerAppTool(
    server,
    "accept_quote_spike",
    {
      title: "Accept quote (widget only)",
      description: "Accepts the quote. Only the quote widget's button may call this.",
      inputSchema: { projectId: z.string() },
      _meta: { ui: { resourceUri: "ui://payleor/quote", visibility: ["app"] } },
    },
    async ({ projectId }) => {
      deps.log.set({ mcp: { tool: "accept_quote_spike", projectId, userId: deps.userId } });
      return { content: [{ type: "text", text: "Recorded (spike: nothing changed)." }], structuredContent: { ok: true } };
    },
  );

  return server;
}

export function createSpikeMcpRoute(deps: Omit<SpikeDeps, "userId">, authUrl: string) {
  const resource = mcpResourceFor(authUrl);
  return requireMcpAuth(
    deps.auth,
    async (request, claims) => {
      const userId = claims.sub ?? "";
      const rpc = await request
        .clone()
        .json()
        .catch(() => null);
      const rpcInfo = z
        .object({
          method: z.string().optional(),
          params: z
            .object({ protocolVersion: z.string().optional(), clientInfo: z.unknown(), capabilities: z.unknown(), name: z.string().optional() })
            .partial()
            .optional(),
        })
        .safeParse(rpc);
      const params = rpcInfo.success ? rpcInfo.data.params : undefined;
      console.log("SPIKE_RPC", {
        ...{
          method: rpcInfo.success ? (rpcInfo.data.method ?? "") : "unparsed",
          versionHeader: request.headers.get("mcp-protocol-version") ?? "",
          agent: request.headers.get("user-agent") ?? "",
          initVersion: params?.protocolVersion ?? "",
          toolName: params?.name ?? "",
          clientInfo: params?.clientInfo ? JSON.stringify(params.clientInfo) : "",
          capabilities: params?.capabilities ? JSON.stringify(params.capabilities).slice(0, 800) : "",
        },
      });
      deps.log.set({ mcp: { userId, clientId: claims.azp ?? claims.client_id } });
      const handler = createMcpHandler(() => buildServer({ ...deps, userId }), { legacy: "stateless" });
      // The response streams while tools run; buffer it so the per-request database client, closed once the
      // response is returned, outlives every tool call.
      const response = await handler.fetch(request);
      const body = await response.arrayBuffer();
      return new Response(body, { status: response.status, headers: response.headers });
    },
    { resource },
  );
}
