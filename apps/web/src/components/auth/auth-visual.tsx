import { cn } from "@jendal-workspace/ui/lib/utils";

// The right half of the sign-in pages: one sample project told in three beats, the way the marketing site's stage
// tells it. A client asks Claude, accepts a quote and pays its deposit, and a member is paid after an approval.
// The figures add up so the money reads true; the caption says they are examples. Hidden on phones, where the form
// is the whole page.
const beat =
  "animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-500 ease-out motion-reduce:animate-none";

export default function AuthVisual({
  headline = "A request from Claude becomes a paid project.",
  subline,
}: {
  headline?: React.ReactNode;
  subline?: React.ReactNode;
}) {
  return (
    <aside
      aria-label="Example project"
      className="hidden min-h-0 flex-col justify-center gap-5 overflow-hidden rounded-[24px] bg-stage px-14 py-12 text-stage-ink [--border:var(--stage-line)] [--card:var(--stage-card)] [--tray:var(--stage)] short:gap-4 short:py-8 lg:flex"
    >
      <div className="mx-auto flex w-full max-w-[440px] flex-col gap-5 short:gap-4">
        <div>
          <h2 className="max-w-[18ch] font-heading text-[30px] leading-[1.1] tracking-[-0.03em] short:text-[26px]">
            {headline}
          </h2>
          {subline ? <p className="mt-3 max-w-sm text-sm text-stage-muted">{subline}</p> : null}
        </div>

        <figure className={cn(beat, "flex flex-col items-end gap-1.5 [animation-delay:120ms]")}>
          <p className="max-w-[340px] rounded-[16px_16px_4px_16px] bg-band-raise px-4 py-3 text-[15px]">
            Find someone to design a logo for my bakery, under $900.
          </p>
          <figcaption className="text-xs text-stage-muted">The client, asking Claude</figcaption>
        </figure>

        <div className={cn(beat, "frame frame-panel [animation-delay:320ms]")}>
          <div className="frame-head text-[13px]">
            <span className="font-medium">Walk Crew</span>
            <span className="ml-auto text-stage-muted">Quote</span>
          </div>
          <div className="frame frame-body px-4 py-3.5">
            <p className="font-semibold">Logo and brand kit</p>
            <p className="text-[13px] text-stage-muted">10 days, 2 free revisions</p>
            <dl className="mt-2 font-tabular text-sm">
              <Row label="Total" value="$640.00" />
              <Row label="Deposit now, 60%" value="$384.00" strong />
            </dl>
            <span className="key-mint mt-3 inline-flex h-9 items-center px-4 text-sm font-semibold">
              Accept and pay deposit
            </span>
          </div>
        </div>

        <div className={cn(beat, "frame frame-panel [animation-delay:520ms]")}>
          <div className="frame-head text-[13px]">
            <span className="font-medium">Payout to Amadou</span>
            <span className="ml-auto font-medium text-brand">Paid</span>
          </div>
          <div className="frame frame-body px-4 py-3">
            <dl className="font-tabular text-sm">
              <Row label="Project total" value="$640.00" />
              <Row label="Team keeps 15%" value="−$96.00" />
              <Row label="Sent to Amadou" value="$544.00" strong />
            </dl>
            <p className="mt-1.5 text-[13px] text-stage-muted">Approved by Ada, sent by PayPal.</p>
          </div>
        </div>

        <p className="text-xs text-stage-muted">Sample project. Names and amounts are examples.</p>
      </div>
    </aside>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 shadow-[inset_0_-1px_0_var(--stage-line)] last:shadow-none">
      <dt className={strong ? "text-stage-ink" : "text-stage-muted"}>{label}</dt>
      <dd className={strong ? "font-semibold" : undefined}>{value}</dd>
    </div>
  );
}
