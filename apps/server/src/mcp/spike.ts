import { type Auth, mcpResourceFor } from "@jendal-workspace/auth";
import { linkSecret, signClientLink } from "@jendal-workspace/api/client-links";
import type { EmailServices } from "@jendal-workspace/api/context";
import { getClientProjectView } from "@jendal-workspace/api/use-cases/project-views";
import { acceptDelivery, acceptQuote, requestChanges } from "@jendal-workspace/api/use-cases/projects";
import { createQuoteRequest } from "@jendal-workspace/api/use-cases/requests";
import { projectStatusLabel } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import {
  findClientProject,
  findListedOffering,
  findUserIdentity,
  isMemberOfTeamWorkspace,
  type ListedOffering,
  listClientProjects,
  searchListedOfferings,
} from "@jendal-workspace/db/repositories/mcp-spike";
import { requireMcpAuth } from "@better-auth/mcp";
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type { RequestLogger } from "evlog";
import { z } from "zod";

import { type ConfirmationAction, issueConfirmation, verifyConfirmation } from "./confirmation";
import { WIDGET_CSP_DOMAINS, WIDGET_HTML } from "./widget";

const WIDGET_URI = "ui://payleor/app-v4";

const SERVER_INSTRUCTIONS = `Payleor is where clients hire freelancers, studios and AI sellers for paid work, and pay with PayPal. Use these tools when the user wants work done for them (design, development, writing, video, marketing) or asks about a Payleor project.
Flow: search_offerings -> agree on the brief with the user -> request_quote -> the seller answers with a quote -> get_project shows it -> the user accepts and pays with the card's buttons -> the seller delivers -> the user accepts the delivery or asks for changes (request_changes) -> the user pays the balance.
Rules: the user accepts quotes and deliveries and pays only with the buttons in Payleor's cards; never claim you paid or accepted, never ask for or repeat a pay link. Prices are in the seller's currency; a quote is the seller's price for this brief and may differ from the listed range.`;

type Deps = {
  db: Database;
  auth: Auth;
  email: EmailServices;
  log: RequestLogger;
  userId: string;
};

type Identity = { userId: string; email: string; name: string };

class ToolRefusal extends Error {}

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);

const daysLabel = (min: number, max: number) => (min === max ? `${min} days` : `${min}–${max} days`);

function textResult(text: string, structuredContent: Record<string, unknown>, meta?: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], structuredContent, ...(meta ? { _meta: meta } : {}) };
}

function refusal(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

// Use cases throw TRPCError or ActionError with messages written for people; the model passes them on.
function errorMessage(error: unknown): string {
  if (error instanceof ToolRefusal) return error.message;
  if (error instanceof Error && "code" in error && error.message) return error.message;
  return "Payleor could not do that right now. Try again in a moment.";
}

async function guarded<T>(deps: Deps, tool: string, run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    deps.log.set({ mcpError: { tool, message: error instanceof Error ? error.message : String(error) } });
    return refusal(errorMessage(error));
  }
}

async function identity(deps: Deps): Promise<Identity> {
  const row = await findUserIdentity(deps.db, deps.userId);
  if (!row) throw new ToolRefusal("Your Payleor account was not found. Reconnect Payleor.");
  if (!row.emailVerified) throw new ToolRefusal("Verify your Payleor email address first, then try again.");
  return { userId: row.id, email: row.email.toLowerCase(), name: row.name };
}

// A member of the project's team is never its client, whatever email they hold.
async function requireClientProject(deps: Deps, who: Identity, projectId: string) {
  const row = await findClientProject(deps.db, { projectId, clientEmail: who.email });
  if (!row) throw new ToolRefusal("No project with this id belongs to you. Call list_my_projects to see yours.");
  if (await isMemberOfTeamWorkspace(deps.db, { teamId: row.teamId, userId: who.userId })) {
    throw new ToolRefusal("You are on this seller's team, so you cannot act as the client of this project.");
  }
  return row;
}

function offeringView(o: ListedOffering) {
  return {
    id: o.id,
    name: o.name,
    seller: o.seller,
    description: o.description,
    priceMinMinor: o.priceMinMinor,
    priceMaxMinor: o.priceMaxMinor,
    currency: "USD",
    days: daysLabel(o.daysMin, o.daysMax),
    fulfilment: "By people",
    intakeQuestions: o.intakeQuestions,
  };
}

type ClientView = Awaited<ReturnType<typeof getClientProjectView>>;

function nextStep(view: ClientView, seller: string): { text: string; actions: string[] } {
  const { project } = view;
  const proposed = view.quotes.find((q) => q.status === "proposed");
  const payable = view.payments.find((p) => p.payPath !== null && !p.processing);
  const openDelivery = view.deliveries.find((d) => d.status === "submitted");
  const pendingAmendment = view.amendments.some((a) => a.status === "pending");
  const accepted = view.quotes.find((q) => q.status === "accepted");
  if (pendingAmendment) {
    return { text: `${seller} proposed a change to the scope or price. Open the project page to answer it.`, actions: ["open"] };
  }
  switch (project.status) {
    case "quoting":
      return proposed
        ? { text: "Review the quote. Press Accept quote to go ahead; the deposit is due next.", actions: ["accept_quote", "open"] }
        : { text: `Waiting for ${seller} to send a quote.`, actions: ["open"] };
    case "awaiting_deposit":
    case "awaiting_balance":
      return payable
        ? {
            text: `Pay the ${payable.kind === "balance" ? "balance" : "deposit"} of ${money(payable.amountMinor, project.currency)} with PayPal${project.status === "awaiting_deposit" ? " to start the work" : " to complete the project"}.`,
            actions: ["pay", "open"],
          }
        : { text: "PayPal is finishing the payment. Check again in a minute.", actions: ["open"] };
    case "in_progress":
      return payable
        ? { text: `Pay the top-up of ${money(payable.amountMinor, project.currency)} so the extra work can start.`, actions: ["pay", "open"] }
        : {
            text: `${seller} is working on it${accepted ? `; delivery is planned within ${accepted.deliveryDays} days of the deposit` : ""}.`,
            actions: ["open"],
          };
    case "delivered":
      return openDelivery
        ? { text: "Review the delivery, then accept it or request changes.", actions: ["accept_delivery", "request_changes", "open"] }
        : { text: "The delivery is being reviewed.", actions: ["open"] };
    case "completed":
      return { text: "The project is completed and paid.", actions: ["open"] };
    case "cancelled":
      return { text: "The project was cancelled.", actions: ["open"] };
  }
}

async function projectResult(deps: Deps, who: Identity, projectId: string, lead?: string) {
  const row = await requireClientProject(deps, who, projectId);
  const view = await getClientProjectView({ db: deps.db, auth: deps.auth }, row.id);
  const { project } = view;
  const secret = linkSecret(deps.auth);
  const step = nextStep(view, row.seller);
  const quote = view.quotes.find((q) => q.status === "proposed") ?? view.quotes.find((q) => q.status === "accepted") ?? null;
  const payable = view.payments.find((p) => p.payPath !== null && !p.processing) ?? null;
  const delivery = view.deliveries.at(-1) ?? null;
  const projectUrl = `${deps.email.siteOrigin}/c/${await signClientLink(secret, row.id)}`;

  const confirmations: Partial<Record<ConfirmationAction, string>> = {};
  if (step.actions.includes("accept_quote") && quote) {
    confirmations.accept_quote = await issueConfirmation(secret, {
      action: "accept_quote",
      userId: who.userId,
      projectId: row.id,
      targetId: quote.id,
    });
  }
  if (step.actions.includes("accept_delivery") && delivery) {
    confirmations.accept_delivery = await issueConfirmation(secret, {
      action: "accept_delivery",
      userId: who.userId,
      projectId: row.id,
      targetId: delivery.id,
    });
  }

  const structured = {
    view: "project",
    project: {
      id: project.id,
      title: project.title,
      seller: row.seller,
      status: project.status,
      statusLabel: projectStatusLabel(project.status),
      currency: project.currency,
      brief: project.brief,
    },
    quote: quote && {
      id: quote.id,
      version: quote.version,
      status: quote.status,
      amountMinor: quote.amountMinor,
      deliveryDays: quote.deliveryDays,
      items: quote.items.map((item) => ({ description: item.description, amountMinor: item.amountMinor })),
    },
    payment: payable && { kind: payable.kind, amountMinor: payable.amountMinor },
    delivery: delivery && {
      id: delivery.id,
      status: delivery.status,
      note: delivery.note,
      hasLink: Boolean(delivery.link),
      file: delivery.file?.name ?? null,
    },
    nextStep: step.text,
    actions: step.actions,
  };
  const lines = [
    lead,
    `${project.title} with ${row.seller}: ${projectStatusLabel(project.status)}.`,
    quote ? `Quote v${quote.version} (${quote.status}): ${money(quote.amountMinor, project.currency)}, ${quote.deliveryDays} days.` : null,
    delivery ? `Latest delivery (id ${delivery.id}): ${delivery.status}.` : null,
    `Next step: ${step.text}`,
    step.actions.some((a) => a === "accept_quote" || a === "accept_delivery" || a === "pay")
      ? "The user does this with the buttons in the card above."
      : null,
  ].filter(Boolean);
  // The pay and project URLs and the confirmation tokens are for the widget only.
  return textResult(lines.join("\n"), structured, {
    payleor: { confirmations, payUrl: payable?.payPath ? `${deps.email.siteOrigin}${payable.payPath}` : null, projectUrl },
  });
}

const uiTool = (visibility: ("model" | "app")[] = ["model", "app"]) => ({ ui: { resourceUri: WIDGET_URI, visibility } });

function buildServer(deps: Deps): McpServer {
  const server = new McpServer({ name: "payleor", version: "0.1.0" }, { instructions: SERVER_INSTRUCTIONS });

  registerAppResource(
    server,
    "Payleor",
    WIDGET_URI,
    { mimeType: RESOURCE_MIME_TYPE, description: "Payleor cards: offerings, projects, quotes, payments and deliveries." },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: RESOURCE_MIME_TYPE,
          text: WIDGET_HTML,
          _meta: {
            ui: { csp: { resourceDomains: WIDGET_CSP_DOMAINS }, prefersBorder: true },
            "openai/widgetDescription":
              "Payleor card for offerings, projects, quotes, payments and deliveries. The user accepts and pays with its buttons.",
            "openai/widgetCSP": { resource_domains: WIDGET_CSP_DOMAINS, redirect_domains: [deps.email.siteOrigin] },
          },
        },
      ],
    }),
  );

  registerAppTool(
    server,
    "search_offerings",
    {
      title: "Search offerings",
      description:
        "Use this when the user wants someone to do paid work for them (a logo, a landing page, a design, a video, copy, code) or wants to find and compare freelancers, studios or AI sellers, especially within a budget or a deadline. Returns Payleor sellers' offerings with the price range, the usual days, how the work is fulfilled and the questions the seller asks.",
      inputSchema: {
        query: z.string().min(1).describe("A few words for the kind of work, for example 'logo' or 'landing page'"),
        maxPrice: z.number().positive().optional().describe("The user's budget in dollars, if they gave one"),
        maxDays: z.number().int().positive().optional().describe("The user's deadline in days, if they gave one"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { ...uiTool(), "openai/toolInvocation/invoking": "Searching Payleor…", "openai/toolInvocation/invoked": "Found offerings" },
    },
    async ({ query, maxPrice, maxDays }) =>
      guarded(deps, "search_offerings", async () => {
        const words = query
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length > 2)
          .slice(0, 6);
        const rows = await searchListedOfferings(deps.db, {
          words,
          maxPriceMinor: maxPrice === undefined ? undefined : Math.round(maxPrice * 100),
          maxDays,
        });
        deps.log.set({ mcp: { tool: "search_offerings", query, maxPrice, maxDays, results: rows.length } });
        const offerings = rows.map(offeringView);
        const text = offerings.length
          ? [
              `${offerings.length} Payleor offering${offerings.length === 1 ? "" : "s"} for "${query}":`,
              ...offerings.map(
                (o) =>
                  `- ${o.name} by ${o.seller} (id ${o.id}): ${money(o.priceMinMinor, o.currency)}–${money(o.priceMaxMinor, o.currency)}, usually ${o.days}, ${o.fulfilment.toLowerCase()}.${o.intakeQuestions.length ? ` The seller asks: ${o.intakeQuestions.join(" / ")}` : ""}`,
              ),
              "To hire one, agree on a short brief with the user and call request_quote.",
            ].join("\n")
          : `No Payleor offering matches "${query}"${maxPrice ? ` under $${maxPrice}` : ""}. Try broader words, or tell the user nothing fits.`;
        return textResult(text, { view: "offerings", query, offerings });
      }),
  );

  registerAppTool(
    server,
    "request_quote",
    {
      title: "Request a quote",
      description:
        "Use this when the user has chosen an offering and agreed to send a request. Sends the brief to the seller, who replies with a quote; Payleor emails the user a private link to the project. Confirm the brief and the answers to the seller's questions with the user before calling. Clients cannot attach or upload files on Payleor: put links to existing files (current logo, brand guide, references) in the brief, and never promise a place to share files.",
      inputSchema: {
        offeringId: z.string().describe("The id from search_offerings"),
        brief: z.string().min(10).max(5000).describe("What the user wants, in their words: goal, style, deliverables, deadline, budget"),
        answers: z
          .array(z.object({ question: z.string(), answer: z.string() }))
          .max(5)
          .default([])
          .describe("Answers to the seller's intake questions"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      _meta: { ...uiTool(), "openai/toolInvocation/invoking": "Sending your request…", "openai/toolInvocation/invoked": "Request sent" },
    },
    async ({ offeringId, brief, answers }) =>
      guarded(deps, "request_quote", async () => {
        const who = await identity(deps);
        const offering = await findListedOffering(deps.db, offeringId);
        if (!offering) throw new ToolRefusal("That offering is no longer listed. Search again.");
        await createQuoteRequest(
          { db: deps.db, auth: deps.auth, email: deps.email },
          { ip: null },
          { slug: offering.slug, offeringId, name: who.name || who.email, email: who.email, description: brief, answers, website: "" },
        );
        const latest = (await listClientProjects(deps.db, who.email)).find((p) => p.title === offering.name);
        deps.log.set({ mcp: { tool: "request_quote", offeringId, projectId: latest?.id } });
        if (!latest) return textResult(`Request sent to ${offering.seller}.`, { view: "notice", text: "Request sent." });
        return projectResult(deps, who, latest.id, `Request sent to ${offering.seller}. They will reply with a quote. Payleor emailed the user a private link to the project page, which shows the quote, payments and deliveries; it has no file upload or messages.`);
      }),
  );

  registerAppTool(
    server,
    "list_my_projects",
    {
      title: "My projects",
      description:
        "Use this when the user asks about their Payleor projects, quotes, payments or deliveries without naming one, or wants to see what is waiting for them.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { ...uiTool(), "openai/toolInvocation/invoking": "Loading your projects…", "openai/toolInvocation/invoked": "Projects loaded" },
    },
    async () =>
      guarded(deps, "list_my_projects", async () => {
        const who = await identity(deps);
        const rows = await listClientProjects(deps.db, who.email);
        const visible = [];
        for (const row of rows) {
          if (await isMemberOfTeamWorkspace(deps.db, { teamId: row.teamId, userId: who.userId })) continue;
          visible.push({ id: row.id, title: row.title, seller: row.seller, status: row.status, statusLabel: projectStatusLabel(row.status) });
        }
        deps.log.set({ mcp: { tool: "list_my_projects", count: visible.length } });
        const text = visible.length
          ? [`${visible.length} project${visible.length === 1 ? "" : "s"}:`, ...visible.map((p) => `- ${p.title} with ${p.seller} (id ${p.id}): ${p.statusLabel}`), "Call get_project for details and the next step."].join("\n")
          : "The user has no Payleor projects yet. Offer to search offerings.";
        return textResult(text, { view: "projects", projects: visible });
      }),
  );

  registerAppTool(
    server,
    "get_project",
    {
      title: "Show a project",
      description:
        "Use this when the user asks about one Payleor project: its quote, what to pay, the delivery or the next step. Shows a card where the user accepts the quote, pays with PayPal, and accepts the delivery or asks for changes.",
      inputSchema: { projectId: z.string().describe("The id from list_my_projects or request_quote") },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { ...uiTool(), "openai/toolInvocation/invoking": "Opening the project…", "openai/toolInvocation/invoked": "Project ready" },
    },
    async ({ projectId }) =>
      guarded(deps, "get_project", async () => {
        const who = await identity(deps);
        deps.log.set({ mcp: { tool: "get_project", projectId } });
        return projectResult(deps, who, projectId);
      }),
  );

  const confirmationInput = z.string().describe("Given to the card; the model cannot provide it");

  registerAppTool(
    server,
    "accept_quote",
    {
      title: "Accept quote",
      description: "Accepts the quote. Only the Accept quote button in Payleor's card calls this.",
      inputSchema: { projectId: z.string(), quoteId: z.string(), confirmation: confirmationInput },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      _meta: uiTool(["app"]),
    },
    async ({ projectId, quoteId, confirmation }) =>
      guarded(deps, "accept_quote", async () => {
        const who = await identity(deps);
        await requireClientProject(deps, who, projectId);
        const ok = await verifyConfirmation(linkSecret(deps.auth), confirmation, {
          action: "accept_quote",
          userId: who.userId,
          projectId,
          targetId: quoteId,
        });
        if (!ok) throw new ToolRefusal("Press Accept quote in the project card to accept. Show the project again if the card is old.");
        await acceptQuote(deps.db, { projectId, quoteId });
        deps.log.set({ mcp: { tool: "accept_quote", projectId, quoteId } });
        return projectResult(deps, who, projectId, "The user accepted the quote.");
      }),
  );

  registerAppTool(
    server,
    "accept_delivery",
    {
      title: "Accept delivery",
      description: "Accepts the delivery. Only the Accept delivery button in Payleor's card calls this.",
      inputSchema: { projectId: z.string(), deliveryId: z.string(), confirmation: confirmationInput },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      _meta: uiTool(["app"]),
    },
    async ({ projectId, deliveryId, confirmation }) =>
      guarded(deps, "accept_delivery", async () => {
        const who = await identity(deps);
        await requireClientProject(deps, who, projectId);
        const ok = await verifyConfirmation(linkSecret(deps.auth), confirmation, {
          action: "accept_delivery",
          userId: who.userId,
          projectId,
          targetId: deliveryId,
        });
        if (!ok) throw new ToolRefusal("Press Accept delivery in the project card to accept. Show the project again if the card is old.");
        await acceptDelivery(deps.db, { projectId, deliveryId });
        deps.log.set({ mcp: { tool: "accept_delivery", projectId, deliveryId } });
        return projectResult(deps, who, projectId, "The user accepted the delivery.");
      }),
  );

  registerAppTool(
    server,
    "request_changes",
    {
      title: "Request changes",
      description:
        "Use this when the user has reviewed a delivery and wants the seller to change something. Send what should change, in the user's words, after confirming it with them.",
      inputSchema: {
        projectId: z.string(),
        deliveryId: z.string().describe("The delivery id from get_project"),
        note: z.string().min(3).max(5000).describe("What should change"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      _meta: uiTool(),
    },
    async ({ projectId, deliveryId, note }) =>
      guarded(deps, "request_changes", async () => {
        const who = await identity(deps);
        await requireClientProject(deps, who, projectId);
        await requestChanges(deps.db, { projectId, deliveryId, note });
        deps.log.set({ mcp: { tool: "request_changes", projectId, deliveryId } });
        return projectResult(deps, who, projectId, "Changes requested; the seller will deliver again.");
      }),
  );

  return server;
}

export function createSpikeMcpRoute(deps: Omit<Deps, "userId">, authUrl: string) {
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
            .object({ protocolVersion: z.string().optional(), clientInfo: z.unknown(), name: z.string().optional() })
            .partial()
            .optional(),
        })
        .safeParse(rpc);
      console.log("SPIKE_RPC", {
        method: rpcInfo.success ? (rpcInfo.data.method ?? "") : "unparsed",
        versionHeader: request.headers.get("mcp-protocol-version") ?? "",
        agent: request.headers.get("user-agent") ?? "",
        toolName: rpcInfo.success ? (rpcInfo.data.params?.name ?? "") : "",
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
