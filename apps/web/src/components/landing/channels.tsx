"use client";

import { useState } from "react";

import { splitFor, usd } from "./money";

const deposit = splitFor(64_000).deposit.totalMinor;

const CHANNELS = [
  {
    id: "claude",
    name: "Claude",
    fact: "Clients search your services and request a quote without leaving the chat.",
    stage: "bg-field-3",
    fragment: (
      <div className="grid gap-3">
        {[
          ["Logo and brand kit", "$400 – $900", "7–14 days"],
          ["Landing page", "$1,200", "10 days"],
        ].map(([name, price, days]) => (
          <div key={name} className="rounded-[12px] border border-input bg-card p-4">
            <p className="text-[16px] font-semibold">{name}</p>
            <p className="font-tabular text-[15px] font-semibold">{price}</p>
            <p className="text-[13px] text-muted-foreground">Walk Crew · usually {days}</p>
            <span className="mt-3 inline-flex h-10 items-center bg-brand px-4 text-[14px] font-semibold text-brand-foreground bowl">
              Request a quote
            </span>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    fact: "The pay card opens your PayPal pay page. The chat never takes the money.",
    stage: "bg-field-2",
    fragment: (
      <div className="rounded-[12px] border border-input bg-card p-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[16px] font-semibold">Logo and brand kit</p>
          <p className="text-[13px] font-semibold text-brand-text">Awaiting deposit</p>
        </div>
        <p className="text-[13px] text-muted-foreground">with Walk Crew</p>
        <p className="mt-4 font-heading font-tabular text-[28px]">{usd(deposit)}</p>
        <p className="text-[13px] text-muted-foreground">Deposit due: half the quote and the management fee</p>
        <span className="mt-4 inline-flex h-10 items-center bg-brand px-4 text-[14px] font-semibold text-brand-foreground bowl">
          Pay with PayPal
        </span>
        <p className="mt-3 text-[13px] text-muted-foreground">Opens payleor.com/pay in a new tab</p>
      </div>
    ),
  },
  {
    id: "seller",
    name: "Your seller page",
    fact: "Your own page at yourname.payleor.app, or on your own domain.",
    stage: "bg-field-1",
    fragment: (
      <div className="rounded-[12px] border border-input bg-card p-5">
        <span className="grid size-10 place-items-center rounded-[10px] main-surface text-[13px] font-semibold">WC</span>
        <p className="mt-3 font-heading text-[28px] leading-none">Walk Crew</p>
        <p className="mt-2 text-[14px] text-muted-foreground">Websites and brand refreshes for local shops.</p>
        <div className="mt-4 grid gap-2 border-t pt-4" /* taste-skill-ignore: the app's own fragment (data-ui) keeps its borders and shadows */>
          {[
            ["Landing page design", "$400 – $900"],
            ["Logo refresh", "$150"],
          ].map(([name, price]) => (
            <div key={name} className="flex items-baseline justify-between gap-3 text-[14px]">
              <span>{name}</span>
              <span className="font-tabular">{price}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: "discord",
    name: "Discord",
    fact: "Send quotes and payment links from your ticket channels.",
    stage: "bg-field-3",
    fragment: (
      <div className="rounded-[12px] border border-input bg-card p-5">
        <p className="text-[13px] text-muted-foreground">#ticket-0142</p>
        <div className="mt-3 border-l-[3px] border-brand pl-3">
          <p className="text-[15px] font-semibold">Quote sent: Logo and brand kit</p>
          <p className="font-tabular text-[14px]">$640.00 · delivery in 10 days</p>
          <p className="mt-2 text-[13px] text-muted-foreground">The client accepts and pays the deposit from their link.</p>
        </div>
        <span className="mt-4 inline-flex h-10 items-center bg-foreground px-4 text-[14px] font-medium text-background bowl">
          Open the project
        </span>
      </div>
    ),
  },
  {
    id: "link",
    name: "A pay link",
    fact: "Every payment has its own link. The client needs no account.",
    stage: "bg-field-2",
    fragment: (
      <div className="rounded-[12px] border border-input bg-card p-5">
        <p className="text-[13px] text-muted-foreground">Walk Crew</p>
        <p className="font-heading text-[22px]">Logo and brand kit</p>
        <p className="mt-3 font-heading font-tabular text-[34px] leading-none">{usd(deposit)}</p>
        <div className="mt-4 grid gap-1.5 border-t pt-3 text-[14px]" /* taste-skill-ignore: the app's own fragment (data-ui) keeps its borders and shadows */>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Deposit, 50% of the quote</span>
            <span className="font-tabular">$320.00</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Management fee, 10%</span>
            <span className="font-tabular">$64.00</span>
          </div>
        </div>
        <span className="mt-4 flex h-11 items-center justify-center bg-brand text-[14px] font-semibold text-brand-foreground bowl">
          Pay with PayPal
        </span>
      </div>
    ),
  },
] as const;

export default function Channels() {
  const [active, setActive] = useState<string>(CHANNELS[0].id);
  const current = CHANNELS.find((c) => c.id === active) ?? CHANNELS[0];

  return (
    <section aria-labelledby="channels-heading" className="relative grid grid-cols-[minmax(0,1fr)] gap-8 px-4 md:min-h-[100svh]">
      <div className="relative mx-auto grid h-[86vw] w-[86vw] place-items-center md:absolute md:top-1/2 md:left-[58%] md:h-[64vh] md:w-[56vh] md:-translate-x-1/2 md:-translate-y-1/2">
        <span
          aria-hidden="true"
          className={`absolute inset-0 transition-colors duration-300 bowl ${current.stage}`}
        />
        <div className="relative -mt-[14%] w-[84%] max-w-[360px] md:w-[110%]">
          {CHANNELS.map((channel) => (
            <div
              key={channel.id}
              data-ui
              aria-hidden={channel.id !== active}
              className={`text-card-foreground transition-opacity duration-300 ${
                channel.id === active ? "relative opacity-100" : "invisible absolute inset-x-0 top-0 opacity-0"
              }`}
            >
              {channel.fragment}
            </div>
          ))}
        </div>
      </div>

      <div className="md:absolute md:bottom-[14vh] md:left-4 md:pl-6">
        <h2 id="channels-heading" className="font-heading text-[clamp(28px,2.9vw,44px)] leading-[1.15] text-muted-foreground">
          Where clients find you
        </h2>
        <ul className="mt-1 flex gap-6 overflow-x-auto pb-2 md:block md:overflow-visible md:pb-0" role="list">
          {CHANNELS.map((channel) => (
            <li key={channel.id} className="shrink-0">
              <button
                type="button"
                aria-pressed={channel.id === active}
                onClick={() => setActive(channel.id)}
                className="press font-heading text-[26px] leading-[1.15] text-muted-foreground transition-colors duration-150 aria-pressed:text-foreground hover:text-foreground md:text-[clamp(28px,2.9vw,44px)]"
              >
                {channel.name}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <p
        aria-live="polite"
        className="max-w-[30ch] text-[16px] md:absolute md:top-1/2 md:right-6 md:max-w-[22ch] md:-translate-y-1/2 md:text-[17px]"
      >
        {current.fact}
      </p>
    </section>
  );
}
