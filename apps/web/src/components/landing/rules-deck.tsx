"use client";

import { useState } from "react";

const RULES = [
  {
    title: "Paid straight to you",
    text: "Client payments land in your PayPal business account. Payleor never holds your money.",
    meta: "Every plan",
  },
  {
    title: "Agents ask first",
    text: "An agent can draft a quote, a dispute reply or a payout. None of them moves money without a rule you set or your yes.",
    meta: "Every plan",
  },
  {
    title: "Payouts by your rules",
    text: "Approve each payout, auto-approve up to an amount, or pay each finished project after a waiting period.",
    meta: "Set in Payout rules",
  },
  {
    title: "A second approver",
    text: "Above an amount you choose, a payout waits for a second admin before it goes out.",
    meta: "Team and Agency",
  },
  {
    title: "Take everything with you",
    text: "Export your projects, clients, payments and files whenever you like. Your seller page can live on your domain.",
    meta: "Every plan",
  },
] as const;

const TONES = ["bg-card text-card-foreground", "bg-field-2 text-field-2-ink", "bg-field-3 text-field-3-ink"] as const;

export default function RulesDeck() {
  const [open, setOpen] = useState(0);

  return (
    <section aria-labelledby="rules-heading" className="px-4 lg:px-10">
      <h2 id="rules-heading" data-reveal className="font-heading text-[clamp(36px,4.2vw,64px)] leading-[1]">
        Nothing moves without you
      </h2>

      <ol className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-3 lg:flex lg:h-[360px] lg:gap-1" role="list">
        {RULES.map((rule, i) => {
          const isOpen = i === open;
          const tone = TONES[i % TONES.length];
          return (
            <li key={rule.title} className={`${tone} relative overflow-hidden lg:h-full ${isOpen ? "lg:flex-1" : "lg:w-[120px] lg:shrink-0"}`}>
              <div className={`flex h-full flex-col p-6 lg:p-8 ${isOpen ? "lg:min-w-[520px]" : ""}`}>
                <h3 className={`max-w-[18ch] font-heading text-[24px] leading-[1.1] ${isOpen ? "" : "lg:[writing-mode:vertical-rl] lg:rotate-180"}`}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(i)}
                    className="text-left after:absolute after:inset-0 lg:after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                  >
                    {rule.title}
                  </button>
                </h3>
                <p
                  className={`mt-4 max-w-[52ch] text-[17px] leading-relaxed transition-opacity duration-300 ${
                    isOpen ? "" : "lg:hidden"
                  }`}
                >
                  {rule.text}
                </p>
                <p className={`mt-auto pt-6 text-[15px] transition-opacity duration-300 ${isOpen ? "" : "lg:hidden"}`}>
                  {rule.meta}
                </p>
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
