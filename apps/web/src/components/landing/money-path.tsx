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
      className="w-[260px] rounded-[12px] border border-input bg-card p-4 text-left text-card-foreground shadow-[var(--raise)] transition-[translate] duration-150 ease-out group-hover:-translate-y-1.5" /* taste-skill-ignore: the app's own fragment (data-ui) keeps its borders and shadows */
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
  const fields = [
    {
      bg: "bg-field-1 text-field-1-ink",
      clause: "First the client accepts your quote.",
      card: (
        <Card at={0}>
          <Row label="Quote v1" value={usd(s.quoteMinor)} status="Accepted" />
          <Row label="Delivery" value="10 days" />
        </Card>
      ),
    },
    {
      bg: "bg-field-2 text-field-2-ink",
      clause: "Then they pay half up front, with PayPal.",
      card: (
        <Card at={2}>
          <Row label="Quote v1" value={usd(s.quoteMinor)} status="Accepted" />
          <Row label="Deposit" value={usd(s.deposit.totalMinor)} status="Paid" />
        </Card>
      ),
    },
    {
      bg: "bg-field-3 text-field-3-ink",
      clause: "Then you deliver and they sign it off.",
      card: (
        <Card at={6}>
          <Row label="Delivery" value="Accepted" />
          <Row label="Balance" value={usd(balanceMinor)} status="Paid" />
        </Card>
      ),
    },
    {
      bg: "bg-field-4 text-field-4-ink",
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
    <section id="money" aria-labelledby="money-heading" className="grid scroll-mt-4 md:grid-cols-2 lg:grid-cols-4">
      {fields.map((field, i) => (
        <div
          key={field.clause}
          className={`group relative flex min-h-[64svh] flex-col px-5 pt-6 pb-7 md:min-h-[56svh] lg:min-h-[84svh] lg:items-center lg:px-8 ${field.bg}`}
        >
          {i === 0 ? (
            <h2 id="money-heading" data-reveal className="font-heading text-[24px] leading-tight lg:absolute lg:top-7 lg:left-7">
              How the money moves
            </h2>
          ) : null}
          <div data-reveal style={{ "--i": i }} className="mt-6 lg:absolute lg:top-[38%] lg:mt-0">
            {field.card}
          </div>
          <p
            data-reveal
            style={{ "--i": i + 1 }}
            className="mt-auto max-w-[16ch] pt-10 font-heading text-[clamp(22px,2vw,32px)] leading-[1.1] lg:absolute lg:right-7 lg:bottom-7 lg:left-7 lg:max-w-none"
          >
            {field.clause}
          </p>
        </div>
      ))}
    </section>
  );
}
