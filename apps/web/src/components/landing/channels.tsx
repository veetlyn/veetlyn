"use client";

import { useState } from "react";

import { splitFor, usd } from "./money";

const deposit = splitFor(64_000).deposit;

// Every fragment below is the client's side of a real flow: what they type, then what Payleor answers with.

function Bubble({ children, from }: { children: React.ReactNode; from?: string }) {
  return (
    <div className="ml-auto w-fit max-w-[340px]">
      {from ? <p className="mb-1 text-right text-[13px] opacity-70">{from}</p> : null}
      <p className="rounded-[16px] bg-field-3 px-4 py-2.5 text-[15px] text-field-3-ink">{children}</p>
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[12px] border border-input bg-card p-5 text-card-foreground shadow-[var(--raise)] ${className}`} /* taste-skill-ignore: the app's own fragment (data-ui) keeps its borders and shadows */
    >
      {children}
    </div>
  );
}

function Action({ children, tone = "brand" }: { children: React.ReactNode; tone?: "brand" | "ink" }) {
  return (
    <span
      className={`mt-4 inline-flex h-10 items-center px-4 text-[13px] font-semibold bowl ${
        tone === "brand" ? "bg-brand text-brand-foreground" : "bg-foreground text-background"
      }`}
    >
      {children}
    </span>
  );
}

function PayCard() {
  return (
    <Card>
      <p className="text-[13px] text-muted-foreground">Walk Crew</p>
      <p className="font-heading text-[20px]">Logo and brand kit</p>
      <p className="mt-3 font-heading font-tabular text-[36px] leading-none">{usd(deposit.totalMinor)}</p>
      <div className="mt-4 grid gap-1.5 text-[13px]">
        <p className="flex justify-between">
          <span className="text-muted-foreground">Deposit, 50% of the quote</span>
          <span className="font-tabular">{usd(deposit.quotePartMinor)}</span>
        </p>
        <p className="flex justify-between">
          <span className="text-muted-foreground">Management fee, 10%</span>
          <span className="font-tabular">{usd(deposit.managementFeeMinor)}</span>
        </p>
      </div>
      <Action>Pay with PayPal</Action>
    </Card>
  );
}

const CHANNELS = [
  {
    id: "claude",
    name: "Claude",
    fact: "Clients describe what they need. Claude finds your services and they request a quote without leaving the chat.",
    preview: (
      <>
        <Bubble>I need a logo for my bakery, under $900.</Bubble>
        <div className="mt-5 grid grid-cols-2 gap-3">
          {[
            ["Logo and brand kit", "$400 – $900", "7–14 days"],
            ["Logo refresh", "$150", "1–7 days"],
          ].map(([name, price, days]) => (
            <Card key={name} className="p-4">
              <p className="text-[15px] font-semibold">{name}</p>
              <p className="font-tabular text-[15px]">{price}</p>
              <p className="text-[13px] text-muted-foreground">Walk Crew · usually {days}</p>
              <Action>Request a quote</Action>
            </Card>
          ))}
        </div>
      </>
    ),
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    fact: "When the quote is accepted, the pay card opens your PayPal pay page. The chat never takes the money.",
    preview: (
      <>
        <Bubble>Walk Crew sent the quote. Can I pay the deposit now?</Bubble>
        <div className="mt-5 max-w-[340px]">
          <PayCard />
          <p className="mt-2 text-[13px] opacity-70">Opens payleor.com/pay in a new tab</p>
        </div>
      </>
    ),
  },
  {
    id: "seller",
    name: "Your seller page",
    fact: "Your services with their usual price and time, at yourname.payleor.app or on your own domain.",
    preview: (
      <Card className="max-w-[420px] p-6">
        <span className="grid size-11 place-items-center rounded-[10px] main-surface text-[13px] font-semibold">WC</span>
        <p className="mt-4 font-heading text-[32px] leading-none">Walk Crew</p>
        <p className="mt-2 text-[15px] text-muted-foreground">Websites and brand refreshes for local shops.</p>
        <div className="mt-5 grid gap-3">
          {[
            ["Landing page design", "$400 – $900", "1–7 days"],
            ["Logo refresh", "$150", "1–7 days"],
          ].map(([name, price, days]) => (
            <div key={name} className="flex items-center justify-between gap-3 rounded-[10px] bg-tray px-4 py-3 text-[15px]">
              <span>
                <span className="block font-medium">{name}</span>
                <span className="text-[13px] text-muted-foreground">
                  {price} · {days}
                </span>
              </span>
              <span className="text-[13px] font-semibold text-brand-text">Request</span>
            </div>
          ))}
        </div>
      </Card>
    ),
  },
  {
    id: "discord",
    name: "Discord",
    fact: "Quote, send payment links and follow projects from the ticket channels your clients already use.",
    preview: (
      <>
        <Bubble from="Nadia · #ticket-0142">Hi! Can you quote a logo for my bakery?</Bubble>
        <Card className="mt-5 max-w-[400px]">
          <p className="text-[13px] text-muted-foreground">Payleor · in #ticket-0142</p>
          <div className="mt-3 border-l-[3px] border-brand pl-3">
            <p className="text-[15px] font-semibold">Quote sent: Logo and brand kit</p>
            <p className="font-tabular text-[15px]">$640.00 · delivery in 10 days</p>
            <p className="mt-2 text-[13px] text-muted-foreground">Nadia accepts and pays the deposit from her link.</p>
          </div>
          <Action tone="ink">Open the project</Action>
        </Card>
      </>
    ),
  },
  {
    id: "link",
    name: "A pay link",
    fact: "Every payment has its own private link. The client pays as a PayPal guest, with no account to make.",
    preview: (
      <>
        <Bubble from="Email from Walk Crew">Your deposit for Logo and brand kit is ready.</Bubble>
        <div className="mt-5 max-w-[340px]">
          <PayCard />
        </div>
      </>
    ),
  },
] as const;

export default function Channels() {
  const [active, setActive] = useState<string>(CHANNELS[0].id);

  return (
    <section
      aria-labelledby="channels-heading"
      className="grid grid-cols-[minmax(0,1fr)] gap-8 px-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10"
    >
      <div className="lg:py-6 lg:pl-6">
        <h2 id="channels-heading" data-reveal className="font-heading text-[clamp(36px,4vw,64px)] leading-[1]">
          Where clients find you
        </h2>
        <ul className="mt-8 flex gap-6 overflow-x-auto pb-2 lg:mt-10 lg:grid lg:gap-1 lg:overflow-visible lg:pb-0" role="list">
          {CHANNELS.map((channel) => {
            const isActive = channel.id === active;
            return (
              <li key={channel.id} className="shrink-0">
                <button
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setActive(channel.id)}
                  className="press flex items-center gap-3 font-heading text-[24px] leading-[1.2] text-muted-foreground transition-colors duration-150 aria-pressed:text-foreground hover:text-foreground lg:text-[clamp(28px,2.6vw,40px)]"
                >
                  <span
                    aria-hidden="true"
                    className={`hidden h-[0.6em] w-[0.9em] shrink-0 bowl transition-colors duration-150 lg:inline-block ${
                      isActive ? "bg-brand" : "bg-transparent"
                    }`}
                  />
                  {channel.name}
                </button>
                {isActive ? (
                  <p className="mt-2 mb-4 hidden max-w-[40ch] text-[17px] leading-relaxed lg:block lg:pl-[calc(0.9em+0.75rem)]">
                    {channel.fact}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p aria-live="polite" className="mt-3 max-w-[40ch] text-[17px] leading-relaxed lg:hidden">
          {CHANNELS.find((c) => c.id === active)?.fact}
        </p>
      </div>

      <div className="relative flex min-h-[560px] items-center overflow-hidden bg-field-2 px-5 py-10 text-field-2-ink lg:min-h-[640px] lg:px-12 lg:py-14">
        <span aria-hidden="true" className="absolute top-[10%] right-[8%] bottom-[10%] left-[24%] bg-field-1 bowl" />
        {CHANNELS.map((channel) => (
          <div
            key={channel.id}
            data-ui
            aria-hidden={channel.id !== active}
            className={`mx-auto max-w-[600px] transition-opacity duration-300 ${
              channel.id === active ? "relative w-full opacity-100" : "invisible absolute inset-x-5 top-10 opacity-0 lg:inset-x-12 lg:top-14"
            }`}
          >
            {channel.preview}
          </div>
        ))}
      </div>
    </section>
  );
}
