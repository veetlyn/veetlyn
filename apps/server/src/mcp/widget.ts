import { BRIDGE_VERSION } from "./bridge.generated";

// Hosts cache a widget by its URI, so a changed widget gets a new one.
export const WIDGET_URI = "ui://payleor/app-v6";

const CSS = `
  .w {
    --bg: var(--color-background-primary, Canvas);
    --bg2: var(--color-background-secondary, color-mix(in srgb, CanvasText 5%, Canvas));
    --fg: var(--color-text-primary, CanvasText);
    --fg2: var(--color-text-secondary, color-mix(in srgb, CanvasText 66%, Canvas));
    --line: var(--color-border-primary, color-mix(in srgb, CanvasText 14%, Canvas));
    --danger: var(--color-text-danger, light-dark(#b3261e, #f2a49d));
    --ok: var(--color-text-success, light-dark(#1a7f37, #7ccf8f));
    --ring: var(--color-ring-primary, Highlight);
    --brand: #1fbf8f;
    --brand-ink: #0d0d10;
    --brand-accent: light-dark(color-mix(in oklch, #1fbf8f 62%, #141417), color-mix(in oklch, #1fbf8f 80%, #ffffff));
    --r: var(--border-radius-xl, 12px);
    --r-sm: var(--border-radius-md, 8px);
    --f-head: 16px; --f-body: 14px; --f-cap: 12px;
    --w-reg: var(--font-weight-normal, 400); --w-em: var(--font-weight-semibold, 600);
    background: transparent; color: var(--fg);
    font: var(--w-reg) var(--f-body)/1.45 var(--font-sans, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif);
    display: grid; gap: 10px; container-type: inline-size;
  }
  :root { color-scheme: light dark; }
  html, body { background: transparent; margin: 0; }
  body { padding: 4px; }
  .w * { box-sizing: border-box; }
  .w .card { background: var(--bg); border: 1px solid var(--line); border-radius: var(--r); padding: 20px; min-width: 0; }
  @container (min-width: 480px) { .w > .card { padding: 24px 28px; } }
  .w .row { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 16px; }
  .w .head { font-size: var(--f-head); font-weight: var(--w-em); line-height: 1.35; }
  .w .cap { font-size: var(--f-cap); line-height: 1.5; color: var(--fg2); margin-top: 2px; }
  .w .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .w .price { font-weight: var(--w-em); margin-top: 8px; }
  .w .amount { font-size: var(--f-head); font-weight: var(--w-em); line-height: 1.3; margin-top: 12px; }
  .w .status { font-size: var(--f-cap); white-space: nowrap; color: var(--fg2); }
  .w .status.you { color: var(--brand-accent); font-weight: var(--w-em); }
  .w .status.done { color: var(--ok); font-weight: var(--w-em); }
  .w .note { margin: 16px 0 0; padding: 12px 14px; border-radius: var(--r-sm); background: var(--bg2); line-height: 1.55; }
  .w .clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .w .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 12px; margin-top: 20px; }
  .w button { font: inherit; font-weight: var(--w-em); min-height: 44px; min-width: 44px; padding: 10px 18px; border-radius: var(--r-sm); border: 1px solid var(--line); background: var(--bg); color: var(--fg); cursor: pointer; }
  .w button.primary { background: var(--brand); color: var(--brand-ink); border-color: transparent; }
  .w button.quiet { border-color: transparent; background: transparent; color: var(--fg2); text-decoration: underline; text-underline-offset: 3px; font-weight: var(--w-reg); padding-inline: 8px; }
  .w button:disabled { opacity: 0.55; cursor: default; }
  .w button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .w .notice { font-size: var(--f-cap); color: var(--fg2); margin-top: 12px; min-height: 1em; }
  .w .notice.error { color: var(--danger); }
  .w .host-url { font-size: var(--f-cap); color: var(--fg2); margin-top: 12px; overflow-wrap: anywhere; }
  .w .carousel { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(240px, 86%); gap: 12px; overflow-x: auto; scroll-snap-type: x mandatory; scroll-padding-inline: 2px; padding: 2px 2px 6px; scrollbar-width: thin; }
  .w .carousel > .card { scroll-snap-align: start; display: flex; flex-direction: column; }
  .w .carousel .grow { flex: 1; }
  @container (min-width: 520px) { .w .carousel { grid-auto-columns: calc((100% - 12px) / 2.15); } }
  @container (min-width: 660px) { .w .carousel { grid-auto-columns: calc((100% - 24px) / 3); } }
  .w .items { list-style: none; margin: 14px 0 0; padding: 12px 0 0; border-top: 1px solid var(--line); display: grid; gap: 6px; }
  .w .items li { display: flex; justify-content: space-between; gap: 12px; color: var(--fg2); }
  .w .question { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
  .w .sk { height: 12px; border-radius: 6px; background: var(--bg2); margin: 10px 0; animation: pulse 1.4s ease-in-out infinite; }
  .w .sk.h { height: 16px; width: 55%; } .w .sk.s { width: 35%; } .w .sk.btn { height: 44px; width: 140px; border-radius: var(--r-sm); margin-top: 20px; }
  @keyframes pulse { 50% { opacity: 0.55; } }
  @media (prefers-reduced-motion: reduce) { .w .sk { animation: none; } }
`;

// Everything rendered goes through text nodes; strings from sellers and clients reach the model only framed as
// quoted data with control characters stripped and a length cap (security audit B2).
const SCRIPT = `
const app = new App({ name: "payleor", version: "0.3.0" }, {}, { autoResize: true });
const root = document.getElementById("root");
let state = { data: null, meta: null };

const CONTROL = /[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069]/g;
const plain = (value, max) => { const flat = String(value ?? "").replace(CONTROL, "").replace(/\\s+/g, " ").trim(); return flat.length > max ? flat.slice(0, max - 1) + "…" : flat; };
const quoted = (value, max = 120) => "«" + plain(value, max).replace(/[«»]/g, '"') + "»";
const money = (minor, currency = "USD") => new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? "" : v);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
};

function applyHost(ctx) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

const textOf = (result) => (result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\\n");

async function callTool(name, args, button, notice) {
  if (button) { button.disabled = true; button.dataset.label = button.textContent; button.textContent = "Working…"; }
  try {
    const result = await app.callServerTool({ name, arguments: args });
    if (result.isError) throw new Error(textOf(result) || "Payleor refused this action.");
    show(result);
    return result;
  } catch (error) {
    if (notice) { notice.textContent = String(error?.message ?? error); notice.className = "notice error"; }
    if (button) { button.disabled = false; button.textContent = button.dataset.label; }
    return null;
  }
}

// The model sees results of its own calls only; what the user does in the card reaches it here, as data.
async function tellModel(text, structuredContent) {
  try { await app.updateModelContext({ content: [{ type: "text", text }], structuredContent }); } catch {}
}

async function openExternal(url) {
  if (window.openai?.openExternal) { window.openai.openExternal({ href: url }); return true; }
  const result = await app.openLink({ url }).catch(() => ({ isError: true }));
  return !result?.isError;
}

const statusClass = (status) => ["quoting", "awaiting_deposit", "awaiting_balance", "delivered"].includes(status) ? "status you" : status === "completed" ? "status done" : "status";

function offeringsView(data) {
  if (!data.offerings.length) return [el("div", { class: "card" }, el("div", { class: "head" }, "Nothing matches yet"), el("div", { class: "cap" }, "Try broader words or a higher budget."))];
  const range = (o) => o.priceMinMinor === o.priceMaxMinor ? money(o.priceMinMinor, o.currency) : money(o.priceMinMinor, o.currency) + " – " + money(o.priceMaxMinor, o.currency);
  return [el("div", { class: "carousel", role: "list" }, data.offerings.map((o) =>
    el("article", { class: "card", role: "listitem" },
      el("div", { class: "head" }, o.name),
      el("div", { class: "cap" }, o.seller + " · usually " + o.days),
      el("div", { class: "price num" }, range(o)),
      el("p", { class: "cap clamp grow" }, o.description),
      el("div", { class: "actions" },
        el("button", { class: "primary", onclick: async (e) => {
          e.currentTarget.disabled = true;
          e.currentTarget.textContent = "Asked in the chat";
          await tellModel("The user pressed Request a quote on the offering " + quoted(o.name) + " by " + quoted(o.seller, 80) + ".", { offeringId: o.id });
          await app.sendMessage({ role: "user", content: [{ type: "text", text: "I'd like a quote for this offering. Help me write the brief." }] }).catch(() => {});
        } }, "Request a quote")))))];
}

function projectsView(data) {
  if (!data.projects.length) return [el("div", { class: "card" }, el("div", { class: "head" }, "No projects yet"), el("div", { class: "cap" }, "Search for an offering to start one."))];
  return data.projects.map((p) => {
    const notice = el("div", { class: "notice" });
    return el("article", { class: "card" },
      el("div", { class: "row" }, el("div", { class: "head" }, p.title), el("span", { class: statusClass(p.status) }, p.statusLabel)),
      el("div", { class: "cap" }, p.seller + " · requested " + p.requested),
      p.briefStart ? el("p", { class: "cap clamp" }, p.briefStart) : null,
      el("div", { class: "actions" }, el("button", { onclick: (e) => callTool("get_project", { projectId: p.id }, e.currentTarget, notice) }, "Open")),
      notice);
  });
}

async function refreshProject(p, button, notice) {
  const result = await callTool("get_project", { projectId: p.id }, button, notice);
  const next = result?.structuredContent;
  if (next?.project && next.project.status !== p.status) {
    tellModel("The user refreshed the Payleor card: the project " + quoted(p.title) + " is now " + next.project.statusLabel + ".", { projectId: p.id, status: next.project.status });
  }
}

// One slide per freelancer: their quote with its own Accept button, and their questions for the chat.
function freelancerSlide(data, f, tokens, notice) {
  const p = data.project;
  const q = f.quote;
  const quoting = p.status === "quoting";
  const slide = el("article", { class: "card", role: "listitem" },
    el("div", { class: "row" }, el("div", { class: "head" }, f.name), q ? el("span", { class: q.status === "accepted" ? "status done" : q.status === "proposed" ? "status you" : "status" }, q.status === "proposed" ? "Quoted" : q.status === "accepted" ? "Accepted" : "Replaced") : el("span", { class: "status" }, "Asking")));
  if (q) {
    slide.append(
      el("div", { class: "amount num" }, money(q.amountMinor, p.currency)),
      el("div", { class: "cap" }, "Delivery in " + q.deliveryDays + " days"),
      q.items.length > 1 ? el("ul", { class: "items" }, q.items.map((i) => el("li", {}, el("span", {}, i.description), el("span", { class: "num" }, money(i.amountMinor, p.currency))))) : null);
  }
  for (const question of f.questions) {
    slide.append(el("div", { class: "question" },
      el("div", { class: "cap" }, question.answered ? "Question · answered" : "Question"),
      el("p", { class: "clamp" }, question.body),
      question.answered ? null : el("button", { class: "quiet", onclick: async (e) => {
        e.currentTarget.disabled = true;
        await tellModel("The user wants to answer the question from " + quoted(f.name, 60) + ": " + quoted(question.body, 400) + ". Draft the answer with them, confirm it, then call reply.", { projectId: p.id, questionId: question.id });
        await app.sendMessage({ role: "user", content: [{ type: "text", text: "Help me answer this question." }] }).catch(() => {});
      } }, "Answer in the chat")));
  }
  const token = q ? tokens[q.id] : null;
  if (quoting && q?.status === "proposed" && token) {
    slide.append(el("div", { class: "actions" }, el("button", { class: "primary", onclick: async (e) => {
      const result = await callTool("accept_quote", { projectId: p.id, quoteId: q.id, confirmation: token }, e.currentTarget, notice);
      if (result) tellModel("The user accepted the quote from " + quoted(f.name, 60) + " (" + money(q.amountMinor, p.currency) + ") in the Payleor card. The deposit is due next.", { projectId: p.id, quoteId: q.id });
    } }, "Accept quote")));
  }
  return slide;
}

function projectView(data, meta) {
  const p = data.project;
  const notice = el("div", { class: "notice" });
  const links = meta?.payleor ?? {};
  const confirmations = links.confirmations ?? { quotes: {}, delivery: null };
  const has = (a) => data.actions.includes(a);
  const actions = el("div", { class: "actions" });

  if (has("pay") && data.payment && links.payUrl) {
    actions.append(el("button", { class: "primary", onclick: async () => {
      if (!(await openExternal(links.payUrl))) { notice.textContent = "The pay page did not open. Use Open project page instead."; notice.className = "notice error"; return; }
      notice.className = "notice";
      notice.textContent = "PayPal checkout opened in a new tab. After paying, press Check payment.";
      tellModel("The user opened Payleor's pay page for the " + data.payment.kind.replace("_", "-") + " of " + money(data.payment.amountMinor, p.currency) + ".", { projectId: p.id });
    } }, "Pay " + money(data.payment.amountMinor, p.currency) + " with PayPal"));
    actions.append(el("button", { onclick: (e) => refreshProject(p, e.currentTarget, notice) }, "Check payment"));
  } else if (has("accept_delivery") && data.delivery && confirmations.delivery) {
    actions.append(el("button", { class: "primary", onclick: async (e) => {
      const result = await callTool("accept_delivery", { projectId: p.id, deliveryId: data.delivery.id, confirmation: confirmations.delivery }, e.currentTarget, notice);
      if (result) tellModel("The user accepted the delivery of " + quoted(p.title) + " in the Payleor card.", { projectId: p.id });
    } }, "Accept delivery"));
    actions.append(el("button", { onclick: async (e) => {
      e.currentTarget.disabled = true;
      await tellModel("The user pressed Request changes on " + quoted(p.title) + ".", { projectId: p.id, deliveryId: data.delivery.id });
      await app.sendMessage({ role: "user", content: [{ type: "text", text: "I want changes to the delivery." }] }).catch(() => {});
    } }, "Request changes"));
  } else if (has("search")) {
    actions.append(el("button", { class: "primary", onclick: async (e) => {
      e.currentTarget.disabled = true;
      await app.sendMessage({ role: "user", content: [{ type: "text", text: "Search Payleor again for someone else." }] }).catch(() => {});
    } }, "Search again"));
  } else {
    actions.append(el("button", { onclick: (e) => refreshProject(p, e.currentTarget, notice) }, "Refresh"));
  }
  if (links.projectUrl) actions.append(el("button", { class: "quiet", onclick: () => openExternal(links.projectUrl) }, "Open project page"));

  const head = el("article", { class: "card" },
    el("div", { class: "row" }, el("div", { class: "head" }, p.title), el("span", { class: statusClass(p.status) }, p.statusLabel)),
    el("div", { class: "cap" }, "with " + p.seller),
    data.declinedReason ? el("p", { class: "note" }, data.declinedReason) : null,
    data.summary ? el("p", { class: "cap" }, data.summary) : null,
    data.delivery ? el("p", { class: "note" }, "Delivery · " + data.delivery.status.replace("_", " ") + (data.delivery.note ? " — " + data.delivery.note : "")) : null,
    el("p", { class: "note" }, data.nextStep),
    actions,
    has("pay") && links.payUrl ? el("div", { class: "host-url" }, "Opens " + new URL(links.payUrl).host) : null,
    notice);
  const slides = data.freelancers.length && (p.status === "quoting" || data.freelancers.some((f) => f.quote?.status === "accepted"))
    ? el("div", { class: "carousel", role: "list", "aria-label": "Responses by freelancer" }, data.freelancers.map((f) => freelancerSlide(data, f, confirmations.quotes ?? {}, notice)))
    : null;
  return [head, slides];
}

function show(result) {
  state = { data: result?.structuredContent ?? null, meta: result?._meta ?? null };
  const data = state.data;
  if (!data?.view) { root.replaceChildren(el("div", { class: "card" }, el("p", { class: "cap" }, textOf(result) || "Nothing to show."))); return; }
  const views = { offerings: offeringsView, projects: projectsView, project: (d) => projectView(d, state.meta) };
  const render = views[data.view];
  root.replaceChildren(...(render ? render(data) : [el("div", { class: "card" }, textOf(result))]));
}

app.ontoolresult = (result) => show(result);
app.onhostcontextchanged = (ctx) => applyHost(ctx);
await app.connect();
applyHost(app.getHostContext());
`;

// The bridge comes from Payleor's own api host (security audit B3), served by the route in route.ts.
export function widgetHtml(apiOrigin: string): string {
  const bridge = `${apiOrigin}/mcp/bridge-${BRIDGE_VERSION}.js`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark">
<title>Payleor</title>
<style>${CSS}</style></head>
<body><div id="root" class="w" aria-live="polite"><div class="card" aria-label="Loading"><div class="sk h"></div><div class="sk s"></div><div class="sk"></div><div class="sk btn"></div></div></div>
<script type="module">
import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "${bridge}";
${SCRIPT}
</script></body></html>`;
}
