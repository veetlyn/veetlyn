import { splitFor, usd } from "./money";

const STEPS = ["Quote", "Deposit", "Work", "Review", "Balance", "Done"] as const;

function Rail({ at }: { at: number }) {
  return (
    <div className="mt-3">
      <div className="grid grid-cols-6 gap-1" aria-hidden="true">
        {STEPS.map((step, i) => (
          <span key={step} className={`h-1 rounded-full ${i < at ? "bg-brand" : i === at ? "bg-brand/45" : "bg-border"}`} />
        ))}
      </div>
      <p className="mt-1.5 text-[13px] text-muted-foreground">
        {at >= STEPS.length ? "Done" : `Now: ${STEPS[at]}`}
      </p>
    </div>
  );
}

function Row({ label, value, status }: { label: string; value: string; status?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className="font-tabular">{value}</span>
        {status ? <span className="text-[13px] font-semibold text-brand-text">{status}</span> : null}
      </span>
    </div>
  );
}

function Card({ at, children }: { at: number; children: React.ReactNode }) {
  return (
    <div
      data-ui
      className="w-[260px] rounded-[12px] border border-input bg-card p-4 text-left text-card-foreground shadow-[var(--raise)]" /* taste-skill-ignore: the app's own fragment (data-ui) keeps its borders and shadows */
    >
      <p className="text-[15px] font-semibold">Logo and brand kit</p>
      <p className="text-[13px] text-muted-foreground">Walk Crew, for a bakery</p>
      <Rail at={at} />
      <div className="mt-3 grid gap-1.5 border-t pt-3" /* taste-skill-ignore: the app's own fragment (data-ui) keeps its borders and shadows */>{children}</div>
    </div>
  );
}

export default function MoneyPath() {
  const s = splitFor(64_000);
  const balanceMinor = 64_000 - s.deposit.quotePartMinor;
  const steps = [
    {
      amount: usd(s.quoteMinor),
      label: "quoted",
      clause: "First the client accepts your quote.",
      card: (
        <Card at={0}>
          <Row label="Quote v1" value={usd(s.quoteMinor)} status="Accepted" />
          <Row label="Delivery" value="10 days" />
        </Card>
      ),
    },
    {
      amount: usd(s.deposit.totalMinor),
      label: "deposit paid, with the 10% fee",
      clause: "Then they pay half up front, with PayPal.",
      card: (
        <Card at={2}>
          <Row label="Quote v1" value={usd(s.quoteMinor)} status="Accepted" />
          <Row label="Deposit" value={usd(s.deposit.totalMinor)} status="Paid" />
        </Card>
      ),
    },
    {
      amount: usd(balanceMinor),
      label: "balance paid",
      clause: "Then you deliver and they sign it off.",
      card: (
        <Card at={6}>
          <Row label="Delivery" value="Accepted" />
          <Row label="Balance" value={usd(balanceMinor)} status="Paid" />
        </Card>
      ),
    },
    {
      amount: usd(s.memberReceivesMinor),
      label: "sent to Amadou",
      clause: "Then everyone is paid on Tuesday.",
      card: (
        <Card at={6}>
          <Row label="Amadou, designer" value={usd(s.memberReceivesMinor)} status="Sent" />
          <Row label="Your team keeps" value={usd(s.teamKeepsMinor)} />
          <Row label="Payleor's fee" value={usd(s.platformFeeMinor)} />
        </Card>
      ),
    },
  ];

  return (
    <section id="money" aria-labelledby="money-heading" className="scroll-mt-4 px-4">
      <div className="bg-field-1 px-6 py-12 text-field-1-ink lg:px-12 lg:py-16">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <h2 id="money-heading" data-reveal className="font-heading text-[clamp(36px,4vw,64px)] leading-[1]">
            How the money moves
          </h2>
          <p data-reveal style={{ "--i": 1 }} className="max-w-[44ch] text-[17px] leading-relaxed">
            One project, from the first quote to payday. Every amount is what the app works out for a $640 logo.
          </p>
        </div>
        <ol className="relative mt-14 grid grid-cols-[minmax(0,1fr)] gap-14 lg:grid-cols-4 lg:gap-8">
          <span
            aria-hidden="true"
            className="absolute top-3 bottom-0 left-[11px] w-0.5 bg-border lg:top-[11px] lg:right-0 lg:bottom-auto lg:left-0 lg:h-0.5 lg:w-auto"
          />
          <span
            aria-hidden="true"
            data-draw
            className="absolute top-3 bottom-0 left-[11px] w-0.5 bg-brand lg:top-[11px] lg:right-0 lg:bottom-auto lg:left-0 lg:h-0.5 lg:w-auto"
          />
          {steps.map((step, i) => (
            <li key={step.clause} className="relative pl-12 lg:pl-0">
              <span
                aria-hidden="true"
                data-reveal
                style={{ transitionDelay: `${300 + i * 350}ms` }}
                className="absolute top-0 left-0 size-6 bg-brand bowl"
              />
              <div className="lg:pt-14">
                <p className="font-heading font-tabular text-[clamp(36px,3.6vw,56px)] leading-none">{step.amount}</p>
                <p className="mt-2 text-[15px] opacity-80">{step.label}</p>
                <p className="mt-6 max-w-[18ch] font-heading text-[24px] leading-[1.15]">{step.clause}</p>
                <div className="mt-6">{step.card}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
