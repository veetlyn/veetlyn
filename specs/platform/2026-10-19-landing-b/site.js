(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.documentElement.classList.add("js");

  // Entrances: parts rise in once as they arrive.
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }, { rootMargin: "0px 0px -8% 0px" });
  document.querySelectorAll("[data-in]").forEach((el, i) => { el.style.transitionDelay = `${(i % 3) * 80}ms`; io.observe(el); });

  // Chat demos: type the client's message, show each frame at its time, press each button, rest on the end state.
  for (const stage of document.querySelectorAll(".stage[data-play]")) {
    const typed = stage.querySelector("[data-type]");
    const message = typed.textContent;
    const frames = [...stage.querySelectorAll(".frame")];
    const presses = [...stage.querySelectorAll("[data-press]")];
    for (const b of presses) b.dataset.label = b.textContent;
    let timers = [];
    const later = (ms, fn) => timers.push(setTimeout(fn, ms));
    const done = (b, on) => { b.classList.toggle("done", on); b.textContent = on ? b.dataset.done : b.dataset.label; };
    const caret = () => Object.assign(document.createElement("span"), { className: "caret" });
    function run() {
      for (const f of frames) later(Number(f.dataset.at), () => f.classList.remove("wait"));
      for (const b of presses) {
        const at = Number(b.dataset.press);
        later(at, () => b.classList.add("pressed"));
        later(at + 400, () => { b.classList.remove("pressed"); done(b, true); });
      }
    }
    function play() {
      timers.forEach(clearTimeout); timers = [];
      for (const b of presses) { b.classList.remove("pressed"); done(b, false); }
      if (reduce) { frames.forEach((f) => f.classList.remove("wait")); typed.textContent = message; presses.forEach((b) => done(b, true)); return; }
      frames.forEach((f) => f.classList.add("wait"));
      typed.replaceChildren(caret());
      let i = 0;
      const tick = () => {
        i += 1;
        typed.replaceChildren(message.slice(0, i), ...(i < message.length ? [caret()] : []));
        if (i < message.length) later(28, tick); else run();
      };
      later(500, tick);
    }
    stage.querySelector(".replay")?.addEventListener("click", play);
    play();
  }

  // Stories: on a phone each step carries its own picture; on a wide screen the step nearest the middle
  // drives the pinned stage and the rail fills with progress.
  const stories = [...document.querySelectorAll(".story")].map((story) => {
    const steps = [...story.querySelectorAll(".step")];
    const scenes = [...story.querySelectorAll(".scene")];
    scenes.forEach((scene, i) => {
      const copy = scene.firstElementChild.cloneNode(true);
      const box = document.createElement("div");
      box.className = "inline-scene";
      box.setAttribute("aria-hidden", "true");
      copy.querySelectorAll("[data-grow]").forEach((g) => { g.style.flexGrow = g.dataset.grow; });
      box.append(copy);
      steps[i]?.append(box);
    });
    const grow = [...story.querySelectorAll(".scene [data-grow]")];
    grow.forEach((g) => { g.style.flexGrow = "0.0001"; });
    return { steps, scenes, grow, split: scenes.findIndex((s) => s.querySelector("[data-grow]")), rail: story.querySelector(".rail i"), box: story.querySelector(".steps"), current: -1 };
  });
  function onScroll() {
    const mid = innerHeight * 0.5;
    for (const s of stories) {
      let best = 0;
      s.steps.forEach((step, i) => { if (step.getBoundingClientRect().top < mid) best = i; });
      if (best !== s.current) {
        s.current = best;
        s.steps.forEach((step, i) => step.classList.toggle("on", i <= best));
        s.scenes.forEach((scene, i) => scene.classList.toggle("on", i === best));
        s.grow.forEach((g) => { g.style.flexGrow = best === s.split ? g.dataset.grow : "0.0001"; });
      }
      const r = s.box.getBoundingClientRect();
      if (s.rail) s.rail.style.scale = `1 ${Math.min(1, Math.max(0, (mid - r.top) / r.height))}`;
    }
  }
  if (stories.length) {
    let raf = 0;
    addEventListener("scroll", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(onScroll); }, { passive: true });
    addEventListener("resize", onScroll);
    onScroll();
  }

  // Pricing: product and billing switches, the fee calculator and the bundle.
  const PLANS = {
    services: [
      { name: "Solo", m: 1900, y: 1600, bps: 100 },
      { name: "Team", m: 5900, y: 4900, bps: 50 },
      { name: "Agency", m: 19900, y: 16600, bps: 25 },
    ],
    store: [
      { name: "Starter", m: 1200, y: 900, bps: 200 },
      { name: "Grow", m: 3900, y: 2900, bps: 100 },
      { name: "Scale", m: 12900, y: 9900, bps: 50 },
    ],
  };
  const NETWORK_BPS = 500;
  const state = { product: "services", interval: "monthly", source: "ai", plan: { services: 1, store: 1 }, amount: { services: 640, store: 36 } };
  const usd = (minor, cents = minor % 100 !== 0) => `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 })}`;
  const pct = (bps) => `${bps / 100}%`;
  const feeOf = (minor, bps) => Math.floor((minor * bps + 5000) / 10000);
  const price = (p) => (state.interval === "yearly" ? p.y : p.m);
  const row = (label, minor, sum) => `<p class="row${sum ? " sum" : ""}"><span>${label}</span><span>${usd(minor, true)}</span></p>`;
  const $ = (id) => document.getElementById(id);

  function switchGroup(id, key) {
    const box = $(id);
    if (!box) return;
    box.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      state[key] = b.dataset.v;
      box.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      render();
    });
  }

  function fillSelect(select, kind, picked) {
    if (!select) return;
    select.innerHTML = PLANS[kind].map((p, i) => `<option value="${i}"${i === picked ? " selected" : ""}>${p.name}, ${usd(price(p))} a month</option>`).join("");
  }

  function render() {
    document.querySelectorAll("[data-product]").forEach((el) => { el.hidden = !el.dataset.product.split(" ").includes(state.product); });
    document.querySelectorAll("[data-m]").forEach((el) => { el.textContent = state.interval === "yearly" ? el.dataset.y : el.dataset.m; });
    const calc = $("calc");
    if (calc && state.product !== "both") {
      const kind = state.product;
      fillSelect($("calc-plan"), kind, state.plan[kind]);
      $("amt").value = state.amount[kind];
      $("amt-label").textContent = kind === "store" ? "Order total" : "Project price";
      $("source").hidden = kind !== "services";
      const p = PLANS[kind][state.plan[kind]];
      const minor = Math.max(0, Math.round((Number(state.amount[kind]) || 0) * 100));
      const fee = feeOf(minor, p.bps);
      const network = kind === "services" && state.source === "ai" ? feeOf(minor, NETWORK_BPS) : 0;
      $("calc-lines").innerHTML =
        row(`${pct(p.bps)} ${kind === "store" ? "order" : "payment"} fee`, fee) +
        (kind === "services" ? row("5% network fee, first project", network) : "") +
        row("Payleor", fee + network, true);
      $("calc-note").textContent = kind === "store" ? "PayPal's own fee is separate." : state.source === "ai" ? `The next project with this client: ${pct(p.bps)} only.` : "Your own clients never pay the network fee.";
    }
    const bundle = $("bundle");
    if (bundle) {
      fillSelect($("b-services"), "services", state.plan.services);
      fillSelect($("b-store"), "store", state.plan.store);
      const s = PLANS.services[state.plan.services];
      const t = PLANS.store[state.plan.store];
      const half = price(s) >= price(t) ? t : s;
      const line = (p) => row(`${p.name}${p === half ? ", half price" : ""}`, p === half ? Math.round(price(p) / 2) : price(p));
      $("b-lines").innerHTML = line(s) + line(t) + row("A month", Math.max(price(s), price(t)) + Math.round(Math.min(price(s), price(t)) / 2), true);
      $("b-note").textContent = `Every payment and order pays ${pct(Math.min(s.bps, t.bps))}, the lower fee.`;
    }
  }

  if ($("product") || $("bundle")) {
    switchGroup("product", "product");
    switchGroup("interval", "interval");
    switchGroup("source", "source");
    $("calc-plan")?.addEventListener("change", (e) => { state.plan[state.product] = Number(e.target.value); render(); });
    $("amt")?.addEventListener("input", (e) => { state.amount[state.product] = e.target.value; render(); });
    $("b-services")?.addEventListener("change", (e) => { state.plan.services = Number(e.target.value); render(); });
    $("b-store")?.addEventListener("change", (e) => { state.plan.store = Number(e.target.value); render(); });
    render();
  }

  // Contact: the form writes the email in the visitor's own mail app; nothing is sent from the page.
  const form = $("mail");
  if (form) {
    if (location.hash === "#sales") form.elements.topic.value = "Enterprise and sales";
    if (location.hash === "#membership") form.elements.topic.value = "Network membership";
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const f = form.elements;
      const body = [`Name: ${f.name.value}`, `Company: ${f.company.value}`, `I sell: ${f.sells.value}`, `Team size: ${f.size.value}`, "", f.message.value].join("\n");
      location.href = `mailto:contact@payleor.com?subject=${encodeURIComponent(`${f.topic.value}: ${f.company.value || f.name.value}`)}&body=${encodeURIComponent(body)}`;
    });
  }

  // Header dropdown: one open at a time, closed by a click outside or Escape.
  const drops = [...document.querySelectorAll("details.drop, details.menu")];
  document.addEventListener("click", (e) => { for (const d of drops) if (d.open && !d.contains(e.target)) d.open = false; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") for (const d of drops) if (d.open) { d.open = false; d.querySelector("summary").focus(); } });

  // Discover: category, type, who does the work, sort and search, all on the page.
  const disc = $("discover");
  if (disc) {
    const f = { cat: "all", type: "all", done: "all", sort: "featured", q: new URLSearchParams(location.search).get("q") || "" };
    const grid = disc.querySelector(".items");
    const cards = [...grid.querySelectorAll(".item-card")];
    const q = $("q");
    q.value = f.q;
    function apply() {
      const words = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
      let shown = 0;
      for (const c of cards) {
        const ok = (f.cat === "all" || c.dataset.cat === f.cat) && (f.type === "all" || c.dataset.type === f.type) &&
          (f.done === "all" || c.dataset.done === f.done) && words.every((w) => c.dataset.text.includes(w));
        c.hidden = !ok;
        if (ok) shown += 1;
      }
      grid.append(...[...cards].sort((a, b) => (f.sort === "price" ? a.dataset.price - b.dataset.price : a.dataset.order - b.dataset.order)));
      $("count").textContent = `${shown} ${shown === 1 ? "listing" : "listings"}`;
      $("empty").hidden = shown > 0;
    }
    for (const group of disc.querySelectorAll("[data-filter]")) {
      group.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        f[group.dataset.filter] = b.dataset.v;
        group.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        apply();
      });
    }
    q.addEventListener("input", () => { f.q = q.value; apply(); });
    apply();
  }

  // Blog: show one category at a time.
  const cats = $("cats");
  if (cats) {
    const cardsList = [...document.querySelectorAll(".post-card, .post-feature")];
    const pick = (v) => {
      cats.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.v === v)));
      for (const c of cardsList) c.hidden = v !== "all" && c.dataset.cat !== v;
    };
    cats.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) pick(b.dataset.v); });
    const fromHash = location.hash.slice(1);
    if (fromHash && cats.querySelector(`[data-v="${CSS.escape(fromHash)}"]`)) pick(fromHash);
  }
})();
