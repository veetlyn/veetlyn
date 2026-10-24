import { conversationAnswer, conversationPost } from "@jendal-workspace/api/actions/conversations";
import { deliveryAccept, deliveryRequestChanges } from "@jendal-workspace/api/actions/deliveries";
import { ActionError } from "@jendal-workspace/api/actions/errors";
import { offeringSearch } from "@jendal-workspace/api/actions/offerings";
import { type ActionDeps, perform } from "@jendal-workspace/api/actions/perform";
import { projectClientList, projectClientView } from "@jendal-workspace/api/actions/projects";
import { quoteAccept } from "@jendal-workspace/api/actions/quotes";
import { createRequest } from "@jendal-workspace/api/actions/requests";
import type { Actor } from "@jendal-workspace/api/actions/actors";
import { linkSecret, signAccountClientLink } from "@jendal-workspace/api/client-links";
import { resolveClient } from "@jendal-workspace/api/use-cases/clients";
import { clientPageUrl, teamForProject } from "@jendal-workspace/api/use-cases/link-hosts";
import type { Auth } from "@jendal-workspace/auth";
import { projectStatusLabel } from "@jendal-workspace/core";
import { findClientAccount, projectContactLink } from "@jendal-workspace/db/repositories/contacts";
import { findListedOffering } from "@jendal-workspace/db/repositories/services-catalog";
import type { RequestLogger } from "evlog";

import { type ConfirmationAction, issueConfirmation, verifyConfirmation } from "./confirmation";
import { daysLabel, money, plain, quoted } from "./text";

export type McpDeps = {
  actions: ActionDeps;
  auth: Auth;
  log: RequestLogger;
  userId: string;
  platformName: string;
  // Builds https://{slug}.example.com for a team's client and pay pages.
  storeOrigin: (slug: string) => string;
};

export class ToolRefusal extends Error {}

export type ToolText = { content: { type: "text"; text: string }[]; isError?: true };

const NOT_YOURS = "No project with this id belongs to you. Call list_my_projects to see yours.";

function request(deps: McpDeps, actor: Actor) {
  return { deps: deps.actions, actor, surface: "mcp" as const, request: { requestId: crypto.randomUUID(), ip: null } };
}

const asUser = (deps: McpDeps): Actor => ({ kind: "user", userId: deps.userId });

// The signed-in user acts as the client of this project only through one of its contacts, and never when they
// are on the project's team (action catalog design §5.4).
async function clientOf(deps: McpDeps, projectId: string): Promise<{ actor: Actor; contactId: string }> {
  const resolved = await resolveClient(deps.actions.db, linkSecret(deps.auth), { projectId, userId: deps.userId });
  if (resolved.ok) return { actor: resolved.actor, contactId: resolved.contactId };
  if (resolved.reason === "team_member") {
    throw new ToolRefusal("You are on this seller's team, so you cannot act as the client of this project.");
  }
  throw new ToolRefusal(NOT_YOURS);
}

// Messages from the use cases are written for people; the model passes them on.
export function refusalText(cause: unknown, platformName: string): string {
  if (cause instanceof ToolRefusal) return cause.message;
  if (cause instanceof ActionError && (cause.code !== "internal" || cause.expose)) return cause.message;
  return `${platformName} could not do that right now. Try again in a moment.`;
}

type ClientView = Awaited<ReturnType<typeof projectClientView.run>>;

type Slide = {
  key: string;
  name: string;
  quote: {
    id: string;
    status: string;
    amountMinor: number;
    deliveryDays: number;
    items: { description: string; amountMinor: number }[];
  } | null;
  questions: { id: string; body: string; answered: boolean }[];
};

// One slide per freelancer (plugin design §8): their latest quote and their questions to the client.
function slidesOf(view: ClientView): Slide[] {
  const slides = new Map<string, Slide>();
  const slide = (freelancer: { key: string; name: string }): Slide => {
    const found = slides.get(freelancer.key) ?? { key: freelancer.key, name: plain(freelancer.name, 60), quote: null, questions: [] };
    slides.set(freelancer.key, found);
    return found;
  };
  for (const q of view.quotes) {
    if (!q.freelancer) continue;
    slide(q.freelancer).quote = {
      id: q.id,
      status: q.status,
      amountMinor: q.amountMinor,
      deliveryDays: q.deliveryDays,
      items: q.items.map((i) => ({ description: plain(i.description, 120), amountMinor: i.amountMinor })),
    };
  }
  const answered = new Set(view.conversation.messages.filter((m) => m.kind === "answer").map((m) => m.replyToId));
  for (const m of view.conversation.messages) {
    if (m.kind !== "question" || !m.freelancer) continue;
    slide(m.freelancer).questions.push({ id: m.id, body: plain(m.body, 400), answered: answered.has(m.id) });
  }
  return [...slides.values()];
}

// "3 freelancers responded: «Aïcha» quoted $150.00 in 4 days; «Ben» asked «…»" (plugin design §8).
type Framing = { name: (value: string) => string; text: (value: string) => string };

// The model reads seller and client words framed as data; the card shows people the same line plainly.
const FOR_MODEL: Framing = { name: (value) => quoted(value, 60), text: (value) => quoted(value, 80) };
const FOR_CARD: Framing = { name: (value) => plain(value, 60), text: (value) => `“${plain(value, 80)}”` };

function summaryLine(slides: readonly Slide[], currency: string, frame: Framing): string | null {
  if (slides.length === 0) return null;
  const parts = slides.map((s) => {
    const said: string[] = [];
    if (s.quote) {
      const lost = s.quote.status === "superseded" || s.quote.status === "rejected";
      said.push(`quoted ${money(s.quote.amountMinor, currency)} in ${s.quote.deliveryDays} days${lost ? ", not chosen" : ""}`);
    }
    const open = s.questions.filter((q) => !q.answered);
    if (open.length > 0) said.push(`asked ${frame.text(open[0]?.body ?? "")}`);
    return `${frame.name(s.name)} ${said.join(" and ") || "is looking at it"}`;
  });
  return `${slides.length} freelancer${slides.length === 1 ? "" : "s"} responded: ${parts.join("; ")}.`;
}

// `text` tells the model what comes next; `card` says it to the person when it reads differently.
type Step = { text: string; actions: string[]; card?: string };

function nextStep(view: ClientView, seller: string, openQuestions: number): Step {
  const { project } = view;
  const proposed = view.quotes.filter((q) => q.status === "proposed");
  const payable = view.payments.find((p) => p.payPath !== null && !p.processing);
  const openDelivery = view.deliveries.find((d) => d.status === "submitted");
  const accepted = view.quotes.find((q) => q.status === "accepted");
  if (view.amendments.some((a) => a.status === "pending")) {
    return { text: `${seller} proposed a change to the scope or price. Open the project page to answer it.`, actions: ["open"] };
  }
  switch (project.status) {
    case "quoting": {
      const answer = openQuestions > 0 ? " Help the user answer the open questions with reply." : "";
      if (proposed.length > 0) {
        const which = proposed.length > 1 ? "Compare the quotes; the user accepts one" : "Review the quote; the user accepts it";
        return {
          text: `${which} with its Accept quote button. The deposit is due next.${answer}`,
          card: `${proposed.length > 1 ? "Compare the quotes and accept the one you want" : "Accept the quote to go ahead"}; the deposit is due next.${openQuestions > 0 ? " Answer open questions in the chat." : ""}`,
          actions: ["accept_quote", "reply", "open"],
        };
      }
      return {
        text: `Waiting for ${seller} to quote.${answer}`,
        card: openQuestions > 0 ? "The team has questions for you; answer them in the chat." : "The team is looking at your request.",
        actions: ["reply", "open"],
      };
    }
    case "declined":
      return {
        text: "The team declined the request. Offer to search again for someone else.",
        card: "The team declined this request.",
        actions: ["search"],
      };
    case "expired":
      return { text: "Nobody answered the request in time. Offer to search again.", card: "This request expired.", actions: ["search"] };
    case "abandoned":
      return {
        text: "The review window closed without an answer, so the project ended per the terms the client accepted.",
        card: "This project ended.",
        actions: ["search"],
      };
    case "awaiting_deposit":
    case "awaiting_balance":
      return payable
        ? {
            text: `Pay the ${payable.kind === "balance" ? "balance" : "deposit"} of ${money(payable.amountMinor, project.currency)} with PayPal${project.status === "awaiting_deposit" ? " to start the work" : " to complete the project"}.`,
            actions: ["pay", "reply", "open"],
          }
        : { text: "PayPal is finishing the payment. Check again in a minute.", actions: ["open"] };
    case "in_progress":
      return payable
        ? { text: `Pay the top-up of ${money(payable.amountMinor, project.currency)} so the extra work can start.`, actions: ["pay", "open"] }
        : {
            text: `${seller} is working on it${accepted ? `; delivery is planned within ${accepted.deliveryDays} days of the deposit` : ""}.`,
            actions: ["reply", "open"],
          };
    case "delivered":
      return openDelivery
        ? { text: "Review the delivery, then accept it or request changes.", actions: ["accept_delivery", "request_changes", "reply", "open"] }
        : { text: "The delivery is being reviewed.", actions: ["open"] };
    case "completed":
      return { text: "The project is completed and paid.", actions: ["open"] };
    case "cancelled":
      return { text: "The project was cancelled.", actions: ["open"] };
  }
}

export type ProjectCard = {
  view: "project";
  project: { id: string; title: string; seller: string; status: string; statusLabel: string; currency: string; brief: string };
  declinedReason: string | null;
  freelancers: Slide[];
  payment: { kind: string; amountMinor: number } | null;
  delivery: { id: string; status: string; note: string; hasLink: boolean; file: string | null } | null;
  openQuestions: { id: string; freelancer: string; body: string }[];
  summary: string | null;
  nextStep: string;
  actions: string[];
};

export type CardMeta = {
  platform: {
    confirmations: { quotes: Record<string, string>; delivery: string | null };
    payUrl: string | null;
    projectUrl: string | null;
  };
};

export async function projectCard(
  deps: McpDeps,
  projectId: string,
  lead?: string,
): Promise<{ text: string; card: ProjectCard; meta: CardMeta }> {
  const { actor, contactId } = await clientOf(deps, projectId);
  const view = await perform(request(deps, actor), projectClientView, { projectId });
  const [team, link] = await Promise.all([
    teamForProject(deps.actions.db, projectId),
    projectContactLink(deps.actions.db, { projectId, contactId }),
  ]);
  const { project } = view;
  const secret = linkSecret(deps.auth);
  const slides = slidesOf(view);
  const openQuestions = slides.flatMap((s) =>
    s.questions.filter((q) => !q.answered).map((q) => ({ id: q.id, freelancer: s.name, body: q.body })),
  );
  const answers = new Map(
    view.conversation.messages.flatMap((m) => (m.kind === "answer" && m.replyToId ? [[m.replyToId, plain(m.body, 400)] as const] : [])),
  );
  const slug = team?.slug ?? null;
  const seller = team ? plain(team.name, 80) : "the team";
  const step = nextStep(view, quoted(seller, 80), openQuestions.length);
  const payable = view.payments.find((p) => p.payPath !== null && !p.processing) ?? null;
  const delivery = view.deliveries.at(-1) ?? null;
  const site = slug ? deps.storeOrigin(slug) : null;

  // Competing quotes each get their own token, so each slide's Accept button works on its own quote only.
  const quotes = Object.fromEntries(
    step.actions.includes("accept_quote")
      ? await Promise.all(
          view.quotes
            .filter((quote) => quote.status === "proposed")
            .map(async (q) => [
              q.id,
              await issueConfirmation(secret, { action: "accept_quote", userId: deps.userId, projectId, targetId: q.id }),
            ]),
        )
      : [],
  );
  const deliveryToken =
    step.actions.includes("accept_delivery") && delivery
      ? await issueConfirmation(secret, { action: "accept_delivery", userId: deps.userId, projectId, targetId: delivery.id })
      : null;
  const projectUrl =
    slug && link
      ? clientPageUrl(deps.storeOrigin, slug, `/c/${await signAccountClientLink(secret, { projectId, contactId, version: link.linkVersion })}`)
      : null;

  const card: ProjectCard = {
    view: "project",
    project: {
      id: project.id,
      title: plain(project.title, 120),
      seller,
      status: project.status,
      statusLabel: projectStatusLabel(project.status),
      currency: project.currency,
      brief: plain(project.brief, 600),
    },
    declinedReason: project.declinedReason ? plain(project.declinedReason, 600) : null,
    freelancers: slides,
    payment: payable && { kind: payable.kind, amountMinor: payable.amountMinor },
    delivery: delivery && {
      id: delivery.id,
      status: delivery.status,
      note: plain(delivery.note, 600),
      hasLink: Boolean(delivery.link),
      file: delivery.file ? plain(delivery.file.name, 120) : null,
    },
    openQuestions,
    summary: summaryLine(slides, project.currency, FOR_CARD),
    nextStep: step.card ?? step.text,
    actions: step.actions,
  };
  const lines = [
    lead,
    `Project ${quoted(project.title)} with ${quoted(seller, 63)} (id ${project.id}): ${projectStatusLabel(project.status)}.`,
    card.declinedReason ? `The team's reason: ${quoted(card.declinedReason, 600)}` : null,
    summaryLine(slides, project.currency, FOR_MODEL),
    ...slides.flatMap((s) =>
      s.quote
        ? [
            `- Quote from ${quoted(s.name, 60)} (quote id ${s.quote.id}, ${s.quote.status}): ${money(s.quote.amountMinor, project.currency)}, ${s.quote.deliveryDays} days; items: ${s.quote.items.map((i) => `${quoted(i.description, 80)} ${money(i.amountMinor, project.currency)}`).join(", ")}.`,
          ]
        : [],
    ),
    ...openQuestions.map((q) => `- Open question from ${quoted(q.freelancer, 60)} (question id ${q.id}): ${quoted(q.body, 400)}`),
    // Answered questions and settled payments stay in the text, so the assistant can still say what was asked and paid.
    ...slides.flatMap((s) =>
      s.questions
        .filter((q) => q.answered)
        .map((q) => {
          const answer = answers.get(q.id);
          return `- Answered question from ${quoted(s.name, 60)} (question id ${q.id}): ${quoted(q.body, 400)}${answer ? `; the answer: ${quoted(answer, 400)}` : ""}`;
        }),
    ),
    ...view.payments.map(
      (p) =>
        `- Payment: ${p.kind} ${money(p.amountMinor, project.currency)}, ${p.status}${p.refundedMinor > 0 ? `, ${money(p.refundedMinor, project.currency)} refunded` : ""}.`,
    ),
    delivery ? `Latest delivery (id ${delivery.id}): ${delivery.status}${delivery.note ? `, note ${quoted(delivery.note, 300)}` : ""}.` : null,
    `Next step: ${step.text}`,
    step.actions.some((a) => a === "accept_quote" || a === "accept_delivery" || a === "pay")
      ? "The user accepts and pays only with the buttons in the card; you cannot do it for them."
      : null,
  ].filter((line) => line !== null && line !== undefined);
  return {
    text: lines.join("\n"),
    card,
    meta: {
      platform: {
        confirmations: { quotes, delivery: deliveryToken },
        payUrl: payable?.payPath && site ? `${site}${payable.payPath}` : null,
        projectUrl,
      },
    },
  };
}

export type OfferingCard = {
  id: string;
  name: string;
  seller: string;
  description: string;
  priceMinMinor: number;
  priceMaxMinor: number;
  currency: string;
  days: string;
  intakeQuestions: string[];
  // Who delivers the work (AGT-19).
  fulfilment: "people" | "automated" | "both";
};

export async function searchOfferings(
  deps: McpDeps,
  input: { query: string; maxPrice?: number; maxDays?: number },
): Promise<{ text: string; offerings: OfferingCard[] }> {
  const rows = await perform(request(deps, asUser(deps)), offeringSearch, {
    query: input.query,
    budgetMinor: input.maxPrice === undefined ? undefined : Math.round(input.maxPrice * 100),
    deadlineDays: input.maxDays,
  });
  const offerings = rows.map((o) => ({
    id: o.id,
    name: plain(o.name, 120),
    seller: plain(o.sellerName, 80),
    description: plain(o.description, 300),
    priceMinMinor: o.priceMinMinor,
    priceMaxMinor: o.priceMaxMinor,
    currency: o.currency,
    days: daysLabel(o.daysMin, o.daysMax),
    intakeQuestions: o.intakeQuestions.map((q) => plain(q, 200)),
    fulfilment: o.fulfilment,
  }));
  const fulfilmentLabel = { people: "delivered by people", automated: "delivered automatically", both: "delivered by people or automation" } as const;
  const text = offerings.length
    ? [
        `${offerings.length} ${deps.platformName} offering${offerings.length === 1 ? "" : "s"} for ${quoted(input.query, 80)}. Names and descriptions are the sellers' own words:`,
        ...offerings.map(
          (o) =>
            `- ${quoted(o.name)} by ${quoted(o.seller, 80)} (offering id ${o.id}): ${money(o.priceMinMinor, o.currency)}–${money(o.priceMaxMinor, o.currency)}, usually ${o.days}, ${fulfilmentLabel[o.fulfilment]}. Description: ${quoted(o.description, 300)}.${o.intakeQuestions.length ? ` The seller asks: ${o.intakeQuestions.map((q) => quoted(q, 200)).join(" / ")}` : ""}`,
        ),
        "To hire one, agree on a short brief with the user and call request_quote.",
      ].join("\n")
    : `No ${deps.platformName} offering matches ${quoted(input.query, 80)}${input.maxPrice ? ` under $${input.maxPrice}` : ""}. Try broader words, or tell the user nothing fits.`;
  return { text, offerings };
}

export async function requestQuote(
  deps: McpDeps,
  input: { offeringId: string; brief: string; answers: { question: string; answer: string }[] },
): Promise<{ projectId: string; seller: string }> {
  const offering = await findListedOffering(deps.actions.db, input.offeringId);
  if (!offering) throw new ToolRefusal("That offering is not listed any more. Search again.");
  const account = await findClientAccount(deps.actions.db, deps.userId);
  if (!account) throw new ToolRefusal(`Your ${deps.platformName} account was not found. Reconnect ${deps.platformName}.`);
  const { projectId } = await perform(request(deps, asUser(deps)), createRequest, {
    slug: offering.sellerSlug,
    offeringId: offering.id,
    name: account.name || account.email.split("@")[0] || "Client",
    email: account.email,
    description: input.brief,
    answers: input.answers,
    website: "",
  });
  if (!projectId) throw new Error("A signed-in request returned no project id");
  return { projectId, seller: plain(offering.sellerName, 80) };
}

export type ProjectRow = {
  id: string;
  title: string;
  seller: string;
  status: string;
  statusLabel: string;
  requested: string;
  briefStart: string;
};

export async function listProjects(deps: McpDeps): Promise<{ text: string; projects: ProjectRow[] }> {
  const rows = await perform(request(deps, asUser(deps)), projectClientList, {});
  const projects = rows.map((p) => ({
    id: p.id,
    title: plain(p.title, 120),
    seller: plain(p.teamName, 80),
    status: p.status,
    statusLabel: projectStatusLabel(p.status),
    requested: p.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
    briefStart: plain(p.briefStart, 140),
  }));
  const text = projects.length
    ? [
        `${projects.length} project${projects.length === 1 ? "" : "s"}, newest first, in the card's order:`,
        ...projects.map(
          (p, i) =>
            `${i + 1}. ${quoted(p.title)} with ${quoted(p.seller, 80)} (id ${p.id}), requested ${p.requested}: ${p.statusLabel}.${p.briefStart ? ` Brief: ${quoted(p.briefStart, 140)}` : ""}`,
        ),
        "Call get_project for details and the next step. When two projects share a title, tell them apart by the brief or the date.",
      ].join("\n")
    : `The user has no ${deps.platformName} projects yet. Offer to search offerings.`;
  return { text, projects };
}

export async function reply(
  deps: McpDeps,
  input: { projectId: string; message: string; questionId?: string; teamOnly?: boolean },
): Promise<string> {
  const { actor } = await clientOf(deps, input.projectId);
  const posted = input.questionId
    ? await perform(request(deps, actor), conversationAnswer, {
        projectId: input.projectId,
        questionId: input.questionId,
        body: input.message,
      })
    : await perform(request(deps, actor), conversationPost, {
        projectId: input.projectId,
        kind: "text",
        body: input.message,
        teamOnly: input.teamOnly ?? false,
      });
  return posted.space === "request"
    ? "Sent. The freelancers looking at the request and the team read it; emails, phone numbers and messaging links are hidden from them until the user accepts a quote."
    : "Sent. Only the team (and the accepted freelancer, once there is one) reads it.";
}

export async function requestChanges(deps: McpDeps, input: { projectId: string; deliveryId: string; note: string }) {
  const { actor } = await clientOf(deps, input.projectId);
  await perform(request(deps, actor), deliveryRequestChanges, input);
}

// Commit tools: callable only with a confirmation the card received for this user, project and target.
export async function acceptWithConfirmation(
  deps: McpDeps,
  action: ConfirmationAction,
  input: { projectId: string; targetId: string; confirmation: string },
): Promise<void> {
  const { actor } = await clientOf(deps, input.projectId);
  const ok = await verifyConfirmation(linkSecret(deps.auth), input.confirmation, {
    action,
    userId: deps.userId,
    projectId: input.projectId,
    targetId: input.targetId,
  });
  const button = action === "accept_quote" ? "Accept quote" : "Accept delivery";
  if (!ok) throw new ToolRefusal(`Press ${button} in the project card to accept. Show the project again if the card is old.`);
  if (action === "accept_quote") {
    await perform(request(deps, actor), quoteAccept, { projectId: input.projectId, quoteId: input.targetId });
  } else {
    await perform(request(deps, actor), deliveryAccept, { projectId: input.projectId, deliveryId: input.targetId });
  }
}
