"use client";

import { useEffect, useState } from "react";

import { splitFor, usd } from "./money";

const EXAMPLES = [
  { title: "Logo and brand kit", quoteMinor: 64_000 },
  { title: "Landing page", quoteMinor: 180_000 },
  { title: "Rebrand for a bakery", quoteMinor: 420_000 },
] as const;

const HOLD_MS = 6_000;
const FADE_MS = 800;

// The hero's live thing: a project price split the way Payleor splits it. It turns through three example projects
// until the visitor types a price of their own.
export default function HeroSplit() {
  const [example, setExample] = useState(0);
  const [typed, setTyped] = useState<string | null>(null);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (typed !== null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let fadeTimer = 0;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      setFading(true);
      fadeTimer = window.setTimeout(() => {
        setExample((i) => (i + 1) % EXAMPLES.length);
        setFading(false);
      }, FADE_MS);
    }, HOLD_MS);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(fadeTimer);
    };
  }, [typed]);

  const current = EXAMPLES[example] ?? EXAMPLES[0];
  const parsed = typed === null ? NaN : Number(typed);
  const quoteMinor =
    typed === null ? current.quoteMinor : Number.isFinite(parsed) && parsed >= 1 ? Math.round(parsed * 100) : 0;
  const split = quoteMinor > 0 ? splitFor(quoteMinor) : null;

  const parts = split
    ? [
        { key: "member", label: "The freelancer receives", minor: split.memberReceivesMinor, tone: "bg-brand" },
        { key: "team", label: "Your team keeps", minor: split.teamKeepsMinor, tone: "bg-foreground" },
        { key: "paypal", label: "PayPal's fees", minor: split.paypalFeesMinor, tone: "bg-muted-foreground/45" },
        { key: "payleor", label: "Payleor's fee, 0.5%", minor: split.platformFeeMinor, tone: "bg-muted-foreground" },
      ]
    : [];

  return (
    <div
      data-ui
      className="w-full max-w-[420px] rounded-[14px] border border-input bg-card p-5 text-card-foreground shadow-[var(--float)]" /* taste-skill-ignore: the app's own fragment (data-ui) keeps its borders and shadows */
    >
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor="hero-price" className="text-[15px] font-medium">
          {typed === null ? current.title : "Your project"}
        </label>
        <span className="text-[15px] text-muted-foreground">Team plan</span>
      </div>
      <div className="mt-2 flex items-center gap-1 rounded-[10px] border border-input bg-background px-3 well">
        <span className="text-2xl text-muted-foreground">$</span>
        <input
          id="hero-price"
          inputMode="decimal"
          value={typed ?? String(current.quoteMinor / 100)}
          onChange={(e) => setTyped(e.target.value.replace(/[^0-9.]/g, ""))}
          aria-describedby="hero-split-note"
          className="h-12 w-full bg-transparent font-heading font-tabular text-2xl outline-none"
        />
      </div>

      <div className={fading ? "opacity-0 transition-opacity duration-700" : "opacity-100 transition-opacity duration-700"}>
        {split ? (
          <>
            <p className="mt-4 text-[15px] text-muted-foreground">
              The client pays <span className="font-tabular text-foreground">{usd(split.clientPaysMinor)}</span>,
              half up front.
            </p>
            <div className="mt-3 flex h-3 gap-[3px] overflow-hidden" aria-hidden="true">
              {parts.map((part) => (
                <span
                  key={part.key}
                  className={`${part.tone} h-full first:rounded-l-[3px] last:rounded-r-full`}
                  style={{ flexGrow: part.minor, flexBasis: 0, minWidth: 4 }}
                />
              ))}
            </div>
            <dl className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-y-2 text-[15px]">
              {parts.map((part) => (
                <div key={part.key} className="contents">
                  <dt className="flex items-center gap-2 pr-4">
                    <span aria-hidden="true" className={`${part.tone} h-2.5 w-3.5 shrink-0 bowl`} />
                    {part.label}
                  </dt>
                  <dd className="text-right font-tabular">{usd(part.minor)}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <p className="mt-4 text-[15px] text-muted-foreground">Enter a price above $1 to see the split.</p>
        )}
      </div>
      <p id="hero-split-note" className="mt-4 text-[13px] text-muted-foreground">
        A 15% team cut and a 10% management fee, paid to a freelancer in the US. PayPal's fees are its standard rates.
      </p>
    </div>
  );
}
