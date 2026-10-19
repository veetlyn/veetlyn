"use client";

import { useState } from "react";

const QUESTIONS = [
  {
    topic: "Holding",
    question: "Does Payleor hold my money?",
    answer:
      "No. Clients pay into your own PayPal business account. Payleor takes its fee as part of the same PayPal payment and never sits between you and your money.",
  },
  {
    topic: "PayPal fees",
    question: "Who pays PayPal's fees?",
    answer:
      "PayPal charges its usual processing fee on each payment and a fee on each payout. You see both before anything is sent, and Payleor adds nothing on top of them.",
  },
  {
    topic: "Payouts",
    question: "How do my freelancers get paid?",
    answer:
      "Each member connects their own PayPal. When a project is done they ask for their share, and it goes out by approval, by a rule you set, or automatically on payday.",
  },
  {
    topic: "Clients",
    question: "Do my clients need an account?",
    answer:
      "No. Each client gets a private link to their project. They accept quotes, pay and approve the delivery from it, and they can pay as a PayPal guest.",
  },
  {
    topic: "Agents",
    question: "Can an AI agent spend my money?",
    answer:
      "No. Agents draft quotes, dispute replies and payouts. Money only moves when a rule you set allows it or a person on your team confirms it.",
  },
  {
    topic: "Leaving",
    question: "Can I leave and take my data?",
    answer:
      "Yes. Export your projects, clients, payments and files at any time, on every plan. Your PayPal account and its history stay yours.",
  },
] as const;

const TONES = [
  "bg-field-2 text-field-2-ink",
  "bg-field-3 text-field-3-ink",
  "bg-field-1 text-field-1-ink",
] as const;

export default function FaqCards() {
  const [open, setOpen] = useState(0);

  return (
    <section id="faq" aria-labelledby="faq-heading" className="scroll-mt-4 px-4">
      <div className="mx-auto max-w-[820px]">
        <h2 id="faq-heading" data-reveal className="font-heading text-[clamp(36px,4vw,64px)] leading-[1]">
          Money questions
        </h2>
        <div className="mt-12">
          {QUESTIONS.map((item, i) => {
            const isOpen = open === i;
            const style = {
              "--tab-x": `calc(${i} * var(--tab-step))`,
              zIndex: i + 1,
              clipPath:
                "polygon(var(--tab-x) 0, calc(var(--tab-x) + var(--tab-w)) 0, calc(var(--tab-x) + var(--tab-w)) 40px, 100% 40px, 100% 100%, 0 100%, 0 40px, var(--tab-x) 40px)",
            };
            return (
              <div
                key={item.topic}
                style={style}
                className={`relative [--tab-step:48px] [--tab-w:120px] lg:[--tab-step:150px] lg:[--tab-w:200px] ${
                  i === 0 ? "" : "-mt-10"
                } ${TONES[i % TONES.length]}`}
              >
                <h3>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`faq-answer-${i}`}
                    onClick={() => setOpen(i)}
                    className="block w-full text-left focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring"
                  >
                    <span className="block h-10 pt-2.5 text-[15px] font-medium" style={{ paddingLeft: "calc(var(--tab-x) + 16px)" }}>
                      {item.topic}
                    </span>
                    <span className="block px-6 pt-2 pb-14 text-[17px] font-medium md:text-[24px] md:leading-tight">{item.question}</span>
                  </button>
                </h3>
                <div id={`faq-answer-${i}`} hidden={!isOpen} className="-mt-10 px-6 pb-16">
                  <p className="max-w-[50ch] text-[17px] leading-relaxed">{item.answer}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
