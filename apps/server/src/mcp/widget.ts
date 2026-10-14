// One MCP Apps widget for every Payleor tool; it renders by structuredContent.view. Colors, fonts and
// radii come from the host (MCP Apps hostContext.styles), with neutral fallbacks.
const BRIDGE_URL = "https://unpkg.com/@modelcontextprotocol/ext-apps@2.0.3/dist/src/app-with-deps.js";

// unpkg serves the bridge; assets.claude.ai serves Claude's host font.
export const WIDGET_CSP_DOMAINS = ["https://unpkg.com", "https://assets.claude.ai"];

export const WIDGET_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark">
<title>Payleor</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: var(--color-background-primary, Canvas);
    --bg2: var(--color-background-secondary, color-mix(in srgb, CanvasText 4%, Canvas));
    --fg: var(--color-text-primary, CanvasText);
    --fg2: var(--color-text-secondary, color-mix(in srgb, CanvasText 65%, Canvas));
    --line: var(--color-border-primary, color-mix(in srgb, CanvasText 14%, Canvas));
    --accent-bg: var(--color-background-inverse, CanvasText);
    --accent-fg: var(--color-text-inverse, Canvas);
    --ok: var(--color-text-success, #1a7f37);
    --warn: var(--color-text-warning, #9a6700);
    --danger: var(--color-text-danger, #cf222e);
    --r: var(--border-radius-lg, 12px);
    --r-sm: var(--border-radius-md, 8px);
    --font: var(--font-sans, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif);
  }
  * { box-sizing: border-box; }
  html, body { background: transparent; }
  body { margin: 0; padding: 4px; font: 14px/1.45 var(--font); color: var(--fg); background: transparent; }
  .stack { display: grid; gap: 8px; }
  .card { background: var(--bg); border: 1px solid var(--line); border-radius: var(--r); padding: 12px 14px; }
  .row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .title { font-weight: var(--font-weight-semibold, 600); font-size: 15px; }
  .muted { color: var(--fg2); font-size: 13px; }
  .price { font-weight: var(--font-weight-semibold, 600); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .desc { margin: 6px 0 0; color: var(--fg2); font-size: 13px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; align-items: flex-start; align-content: flex-start; }
  .tag { font-size: 12px; padding: 1px 8px; border-radius: 999px; background: var(--bg2); color: var(--fg2); }
  .status { font-size: 12px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); white-space: nowrap; }
  .status.go { color: var(--ok); } .status.wait { color: var(--warn); }
  .section { border-top: 1px solid var(--line); margin-top: 10px; padding-top: 10px; }
  .items { margin: 6px 0 0; padding: 0; list-style: none; display: grid; gap: 2px; }
  .items li { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; color: var(--fg2); }
  .next { margin-top: 10px; padding: 8px 10px; border-radius: var(--r-sm); background: var(--bg2); font-size: 13px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; align-items: center; }
  button { font: inherit; font-size: 13px; font-weight: var(--font-weight-medium, 500); border-radius: var(--r-sm); padding: 8px 14px; min-height: 40px; cursor: pointer; border: 1px solid var(--line); background: var(--bg); color: var(--fg); }
  button.primary { background: var(--accent-bg); color: var(--accent-fg); border-color: transparent; }
  button.link { border: none; background: none; padding: 7px 4px; color: var(--fg2); text-decoration: underline; text-underline-offset: 3px; }
  button:disabled { opacity: .55; cursor: default; }
  button:focus-visible { outline: 2px solid var(--color-ring-primary, Highlight); outline-offset: 2px; }
  .notice { font-size: 13px; color: var(--fg2); margin-top: 8px; min-height: 1em; }
  .notice.error { color: var(--danger); }
  .empty { color: var(--fg2); padding: 6px 2px; }
  .carousel { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(220px, 260px); gap: 8px; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 4px; }
  .carousel > .card { scroll-snap-align: start; display: flex; flex-direction: column; }
  .carousel .grow { flex: 1; }
  .skeleton { height: 14px; border-radius: 6px; background: var(--bg2); margin: 6px 0; }
  .skeleton.w60 { width: 60%; } .skeleton.w40 { width: 40%; }
</style></head>
<body><div id="root" class="stack" aria-live="polite"><div class="card" aria-label="Loading"><div class="skeleton w60"></div><div class="skeleton w40"></div><div class="skeleton"></div></div></div>
<script type="module">
import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "${BRIDGE_URL}";

const app = new App({ name: "payleor", version: "0.1.0" }, {}, { autoResize: true });
const root = document.getElementById("root");
let state = { data: null, meta: null };

const money = (minor, currency = "USD") =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
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

function textOf(result) {
  return (result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\\n");
}

async function callTool(name, args, button, notice) {
  if (button) { button.disabled = true; button.dataset.label = button.textContent; button.textContent = "Working…"; }
  try {
    const result = await app.callServerTool({ name, arguments: args });
    if (result.isError) throw new Error(textOf(result) || "Payleor refused this action.");
    show(result);
    return result;
  } catch (error) {
    if (notice) { notice.textContent = String(error.message ?? error); notice.className = "notice error"; }
    if (button) { button.disabled = false; button.textContent = button.dataset.label; }
    return null;
  }
}

async function tellModel(text) {
  try { await app.updateModelContext({ content: [{ type: "text", text }] }); } catch {}
}

function offeringsView(data) {
  if (!data.offerings.length) return [el("div", { class: "card empty" }, "No offering matches this search yet.")];
  const range = (o) => o.priceMinMinor === o.priceMaxMinor ? money(o.priceMinMinor, o.currency) : money(o.priceMinMinor, o.currency) + " – " + money(o.priceMaxMinor, o.currency);
  return [el("div", { class: "carousel", role: "list" }, data.offerings.map((o) =>
    el("article", { class: "card", role: "listitem" },
      el("div", { class: "title" }, o.name),
      el("div", { class: "price" }, range(o)),
      el("div", { class: "muted" }, o.seller + " · usually " + o.days),
      el("div", { class: "tags grow" }, el("span", { class: "tag" }, o.fulfilment)),
      el("div", { class: "actions" },
        el("button", { class: "primary", onclick: async (e) => {
          e.currentTarget.disabled = true;
          e.currentTarget.textContent = "Asked in the chat";
          await app.sendMessage({ role: "user", content: [{ type: "text", text: "I'd like a quote for " + o.name + " by " + o.seller + " (offering " + o.id + "). Help me write the brief." }] }).catch(() => {});
        } }, "Request a quote")))))];
}

function projectsView(data) {
  if (!data.projects.length) return [el("div", { class: "card empty" }, "No projects yet.")];
  return data.projects.map((p) => {
    const notice = el("div", { class: "notice" });
    return el("article", { class: "card" },
      el("div", { class: "row" }, el("div", { class: "title" }, p.title), statusBadge(p.status, p.statusLabel)),
      el("div", { class: "muted" }, "with " + p.seller),
      el("div", { class: "actions" },
        el("button", { onclick: (e) => callTool("get_project", { projectId: p.id }, e.currentTarget, notice) }, "Open")),
      notice);
  });
}

function statusBadge(status, label) {
  const tone = ["completed", "in_progress"].includes(status) ? "go" : ["awaiting_deposit", "awaiting_balance", "delivered"].includes(status) ? "wait" : "";
  return el("span", { class: "status " + tone }, label);
}

async function openExternal(url) {
  // ChatGPT documents window.openai.openExternal; MCP Apps hosts implement ui/open-link.
  if (window.openai?.openExternal) { window.openai.openExternal({ href: url }); return true; }
  const result = await app.openLink({ url }).catch(() => ({ isError: true }));
  return !result?.isError;
}

function projectView(data, meta) {
  const p = data.project;
  const notice = el("div", { class: "notice" });
  const links = meta?.payleor ?? {};
  const confirmations = links.confirmations ?? {};
  const has = (a) => data.actions.includes(a);
  const actions = el("div", { class: "actions" });

  if (has("accept_quote") && data.quote) {
    actions.append(el("button", { class: "primary", onclick: async (e) => {
      const result = await callTool("accept_quote", { projectId: p.id, quoteId: data.quote.id, confirmation: confirmations.accept_quote ?? "" }, e.currentTarget, notice);
      if (result) tellModel("The user accepted quote v" + data.quote.version + " of " + p.title + " (" + money(data.quote.amountMinor, p.currency) + ") in the Payleor card. The deposit is due next.");
    } }, "Accept quote"));
  } else if (has("pay") && data.payment && links.payUrl) {
    actions.append(el("button", { class: "primary", onclick: async () => {
      if (!(await openExternal(links.payUrl))) { notice.textContent = "The pay page did not open. Use Open project page instead."; notice.className = "notice error"; return; }
      notice.className = "notice";
      notice.textContent = "PayPal checkout opened in a new tab. After paying, press Check payment.";
      tellModel("The user opened Payleor's pay page for the " + data.payment.kind + " of " + money(data.payment.amountMinor, p.currency) + " on " + p.title + ".");
    } }, "Pay " + money(data.payment.amountMinor, p.currency) + " with PayPal"));
    actions.append(el("button", { onclick: (e) => callTool("get_project", { projectId: p.id }, e.currentTarget, notice) }, "Check payment"));
  } else if (has("accept_delivery") && data.delivery) {
    actions.append(el("button", { class: "primary", onclick: async (e) => {
      const result = await callTool("accept_delivery", { projectId: p.id, deliveryId: data.delivery.id, confirmation: confirmations.accept_delivery ?? "" }, e.currentTarget, notice);
      if (result) tellModel("The user accepted the delivery of " + p.title + " in the Payleor card.");
    } }, "Accept delivery"));
    actions.append(el("button", { onclick: async (e) => {
      e.currentTarget.disabled = true;
      await app.sendMessage({ role: "user", content: [{ type: "text", text: "I want changes to the delivery of " + p.title + " (project " + p.id + ", delivery " + data.delivery.id + ")." }] }).catch(() => {});
    } }, "Request changes"));
  } else {
    actions.append(el("button", { onclick: (e) => callTool("get_project", { projectId: p.id }, e.currentTarget, notice) }, "Refresh"));
  }
  if (links.projectUrl) actions.append(el("button", { class: "link", onclick: () => openExternal(links.projectUrl) }, "Open project page"));

  const quote = data.quote && el("div", { class: "section" },
    el("div", { class: "row" }, el("div", {}, "Quote" + (data.quote.status === "accepted" ? " · accepted" : "")),
      el("div", { class: "price" }, money(data.quote.amountMinor, p.currency))),
    el("div", { class: "muted" }, "Delivery in " + data.quote.deliveryDays + " days" + (data.payment ? " · " + data.payment.kind.replace("_", "-") + " due " + money(data.payment.amountMinor, p.currency) : "")),
    data.quote.items.length > 1 ? el("ul", { class: "items" }, data.quote.items.map((i) => el("li", {}, el("span", {}, i.description), el("span", {}, money(i.amountMinor, p.currency))))) : null);
  const delivery = data.delivery && el("div", { class: "section" },
    el("div", {}, "Delivery · " + data.delivery.status.replace("_", " ")),
    data.delivery.note ? el("p", { class: "desc" }, data.delivery.note) : null);

  return [el("article", { class: "card" },
    el("div", { class: "row" }, el("div", { class: "title" }, p.title), statusBadge(p.status, p.statusLabel)),
    el("div", { class: "muted" }, "with " + p.seller),
    quote, delivery,
    el("div", { class: "next" }, data.nextStep),
    actions, notice)];
}

function show(result) {
  state = { data: result?.structuredContent ?? null, meta: result?._meta ?? null };
  const data = state.data;
  if (!data?.view) { root.replaceChildren(el("div", { class: "card empty" }, textOf(result) || "Nothing to show.")); return; }
  const views = { offerings: offeringsView, projects: projectsView, project: (d) => projectView(d, state.meta) };
  const render = views[data.view];
  root.replaceChildren(...(render ? render(data) : [el("div", { class: "card" }, textOf(result))]));
}

app.ontoolresult = (result) => show(result);
app.onhostcontextchanged = (ctx) => applyHost(ctx);
await app.connect();
applyHost(app.getHostContext());
</script></body></html>`;
