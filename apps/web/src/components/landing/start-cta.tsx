"use client";

import { TRIAL_DAYS } from "@jendal-workspace/core";
import { useState } from "react";

const KINDS = [
  { id: "services", label: "Services team" },
  { id: "store", label: "Store" },
] as const;

// The page ends on the product's first screen: name the workspace here and carry it into sign-up.
export default function StartCta({ signupUrl }: { signupUrl: string }) {
  const [name, setName] = useState("Walk Crew Studio");
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("services");
  const href = `${signupUrl}?${new URLSearchParams({ workspace: name.trim(), product: kind }).toString()}`;

  return (
    <section
      aria-labelledby="start-heading"
      className="mx-4 grid min-h-[84svh] grid-cols-[minmax(0,1fr)] gap-10 bg-stage px-5 py-14 text-stage-ink lg:min-h-[90svh] lg:grid-cols-12 lg:items-center lg:px-10"
    >
      <div className="lg:col-span-5 lg:self-end lg:pb-10">
        <h2 id="start-heading" data-reveal className="font-heading text-[clamp(52px,7vw,112px)] leading-[0.92]">
          Start your workspace
        </h2>
        <p data-reveal style={{ "--i": 1 }} className="mt-6 max-w-[40ch] text-[17px] leading-relaxed">
          Name it, connect PayPal and send your first quote today. {TRIAL_DAYS} days free, no setup fee.
        </p>
      </div>

      <form
        data-ui
        onSubmit={(e) => {
          e.preventDefault();
          window.location.assign(href);
        }}
        className="w-full rounded-[14px] border border-input bg-card p-6 text-card-foreground shadow-[var(--float)] lg:col-span-5 lg:col-start-7 lg:max-w-[440px] lg:justify-self-end" /* taste-skill-ignore: the app's own fragment (data-ui) keeps its borders and shadows */
      >
        <p className="font-heading text-[22px]">Name your workspace</p>
        <label htmlFor="start-name" className="mt-5 block text-[15px] font-medium">
          Workspace name
        </label>
        <input
          id="start-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-2 h-11 w-full rounded-[10px] border border-input bg-background px-3 text-[16px] well focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
        <p className="mt-5 text-[15px] font-medium">Start with</p>
        <div role="radiogroup" aria-label="Start with" className="mt-2 grid grid-cols-2 gap-1 rounded-[10px] bg-tray p-1">
          {KINDS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={kind === option.id}
              onClick={() => setKind(option.id)}
              className="press h-10 rounded-[8px] text-[15px] font-medium text-muted-foreground aria-checked:bg-card aria-checked:text-foreground aria-checked:shadow-[0_0_0_1px_var(--input),var(--raise)]" /* taste-skill-ignore: the app's own fragment (data-ui) keeps its borders and shadows */
            >
              {option.label}
            </button>
          ))}
        </div>
        <button
          type="submit"
          disabled={name.trim().length < 2}
          className="press mt-6 h-[52px] w-full bg-foreground text-[16px] font-medium text-background bowl disabled:opacity-50"
        >
          Create workspace
        </button>
        <p className="mt-3 text-[13px] text-muted-foreground">Next: your account, then PayPal.</p>
      </form>
    </section>
  );
}
