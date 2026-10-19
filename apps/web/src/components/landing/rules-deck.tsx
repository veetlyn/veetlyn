"use client";

import { useState } from "react";

import { splitFor, usd } from "./money";

const s = splitFor(64_000);

function Proof({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-ui
      className="w-full max-w-[340px] rounded-[12px] border border-input bg-card p-5 text-[13px] text-card-foreground shadow-[var(--raise)]" /* taste-skill-ignore: the app's own fragment (data-ui) keeps its borders and shadows */
    >
      {children}
    </div>
  );
}

function Button({ children, quiet = false }: { children: React.ReactNode; quiet?: boolean }) {
  return quiet ? (
    <span className="flex h-9 items-center px-3 text-muted-foreground">{children}</span>
  ) : (
    <span className="flex h-9 items-center bg-foreground px-4 font-medium text-background bowl">{children}</span>
  );
}

const RULES = [
  {
    title: "Paid straight to you",
    text: "Client payments land in your PayPal business account. Payleor never holds your money.",
    meta: "Every plan",
    proof: (
      <Proof>
        <p className="font-medium">PayPal payments</p>
        <p className="mt-1 font-semibold text-brand-text">Connected</p>
        <p className="mt-3 text-muted-foreground">Client payments are paid out to your PayPal business account.</p>
        <p className="mt-3 flex justify-between">
          <span className="text-muted-foreground">Deposit from the client</span>
          <span className="font-tabular">{usd(s.deposit.totalMinor)}</span>
        </p>
      </Proof>
    ),
  },
  {
    title: "Agents ask first",
    text: "An agent can draft a quote, a dispute reply or a payout. None of them moves money without a rule you set or your yes.",
    meta: "Every plan",
    proof: (
      <Proof>
        <p className="text-muted-foreground">The payout agent prepared a payout</p>
        <p className="mt-2 font-heading text-[18px]">Send {usd(s.memberReceivesMinor)} to Amadou?</p>
        <p className="mt-1 text-muted-foreground">For Logo and brand kit, finished on Friday.</p>
        <div className="mt-4 flex gap-2">
          <Button>Confirm</Button>
          <Button quiet>Not now</Button>
        </div>
      </Proof>
    ),
  },
  {
    title: "Payouts by your rules",
    text: "Approve each payout, auto-approve up to an amount, or pay each finished project after a waiting period.",
    meta: "Set in Payout rules",
    proof: (
      <Proof>
        <p className="font-medium">Auto-approve</p>
        <div className="mt-2 grid grid-cols-3 gap-1 rounded-[10px] bg-tray p-1 text-center">
          <span className="py-1.5 text-muted-foreground">Off</span>
          <span
            className="rounded-[8px] bg-card py-1.5 font-medium shadow-[0_0_0_1px_var(--input)]" /* taste-skill-ignore: the app's own fragment (data-ui) keeps its borders and shadows */
          >
            Up to $100
          </span>
          <span className="py-1.5 text-muted-foreground">Any</span>
        </div>
        <p className="mt-4 flex justify-between">
          <span className="text-muted-foreground">Payday</span>
          <span>Tuesday, every week</span>
        </p>
      </Proof>
    ),
  },
  {
    title: "A second approver",
    text: "Above an amount you choose, a payout waits for a second admin before it goes out.",
    meta: "Team and Agency",
    proof: (
      <Proof>
        <p className="flex justify-between gap-3">
          <span className="font-medium">Studio Lune · $1,800.00</span>
          <span className="font-semibold text-muted-foreground">Waiting</span>
        </p>
        <p className="mt-3 text-muted-foreground">Approved by you. Payouts above $1,000 need a second admin.</p>
        <div className="mt-4 flex gap-2">
          <Button>Approve as second admin</Button>
        </div>
      </Proof>
    ),
  },
  {
    title: "Take everything with you",
    text: "Export your projects, clients, payments and files whenever you like. Your seller page can live on your domain.",
    meta: "Every plan",
    proof: (
      <Proof>
        <p className="font-medium">Export your workspace</p>
        <ul className="mt-3 grid gap-2">
          {["Projects and quotes", "Clients", "Payments and payouts", "Delivery files"].map((item) => (
            <li key={item} className="flex items-center gap-2">
              <span aria-hidden="true" className="h-2 w-3 shrink-0 bg-brand bowl" />
              {item}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex gap-2">
          <Button>Download</Button>
        </div>
      </Proof>
    ),
  },
] as const;

const TONES = ["bg-field-1 text-field-1-ink", "bg-field-2 text-field-2-ink", "bg-field-3 text-field-3-ink"] as const;

export default function RulesDeck() {
  const [open, setOpen] = useState(0);

  return (
    <section aria-labelledby="rules-heading" className="px-4 lg:px-10">
      <h2 id="rules-heading" data-reveal className="font-heading text-[clamp(36px,4.2vw,64px)] leading-[1]">
        Nothing moves without you
      </h2>

      <ol className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-3 xl:flex xl:h-[400px] xl:gap-1" role="list">
        {RULES.map((rule, i) => {
          const isOpen = i === open;
          const tone = TONES[i % TONES.length];
          return (
            <li key={rule.title} className={`${tone} relative overflow-hidden xl:h-full ${isOpen ? "xl:flex-1" : "xl:w-[120px] xl:shrink-0"}`}>
              <div className={`flex h-full flex-col gap-8 p-6 xl:flex-row xl:p-8 ${isOpen ? "xl:min-w-[720px]" : ""}`}>
                <div className="flex flex-1 flex-col">
                  <h3
                    className={`max-w-[18ch] font-heading text-[24px] leading-[1.1] ${
                      isOpen ? "" : "xl:[writing-mode:vertical-rl] xl:rotate-180"
                    }`}
                  >
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(i)}
                      className="text-left after:absolute after:inset-0 xl:after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                    >
                      {rule.title}
                    </button>
                  </h3>
                  <p className={`mt-4 max-w-[40ch] text-[17px] leading-relaxed ${isOpen ? "" : "xl:hidden"}`}>{rule.text}</p>
                  <p className={`mt-auto pt-6 text-[15px] ${isOpen ? "" : "xl:hidden"}`}>{rule.meta}</p>
                </div>
                <div className={`relative z-10 xl:self-center ${isOpen ? "" : "xl:hidden"}`}>{rule.proof}</div>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-12 text-[17px]">
        Five rules, set once for the whole team.{" "}
        <a href="#faq" className="underline decoration-current/30 underline-offset-4 hover:decoration-current">
          Money questions
        </a>
      </p>
    </section>
  );
}
