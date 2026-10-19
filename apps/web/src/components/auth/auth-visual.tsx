import { cn } from "@jendal-workspace/ui/lib/utils";

// The right half of the sign-in pages: the moments Payleor handles, drawn in CSS on a dark stage.
// Decorative only; everything a person needs is in the form beside it.
const MOMENTS = [
  { label: "Quote accepted", detail: "Logo and brand kit", amount: "$640.00", tilt: "-rotate-6", place: "left-[12%] top-[11%]", delay: "[animation-delay:0s]" },
  { label: "Deposit paid with PayPal", detail: "Half up front", amount: "$320.00", tilt: "rotate-3", place: "right-[10%] top-[29%]", delay: "[animation-delay:-2.5s]" },
  { label: "Payout sent", detail: "To Amadou, the designer", amount: "$272.00", tilt: "-rotate-2", place: "left-[18%] top-[47%]", delay: "[animation-delay:-5s]" },
] as const;

export default function AuthVisual() {
  return (
    <div
      aria-hidden="true"
      className="relative hidden overflow-hidden rounded-[22px] bg-stage text-stage-ink lg:block"
    >
      <div className="absolute inset-0 bg-[radial-gradient(var(--stage-line)_1.2px,transparent_1.6px)] bg-[size:22px_22px] [mask-image:radial-gradient(ellipse_at_60%_40%,black_30%,transparent_80%)]" />
      <div className="absolute -top-24 -right-24 size-[420px] rounded-full bg-brand/25 blur-[90px]" />

      <svg viewBox="0 0 32 32" className="absolute -right-[12%] -bottom-[18%] size-[78%] -rotate-12 text-stage-line">
        <path
          d="M10.5 25.5V7.5h7a5.75 5.75 0 0 1 0 11.5h-7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="21.5" y="21.5" width="4" height="4" rx="1" fill="var(--brand)" opacity="0.5" />
      </svg>

      {MOMENTS.map((moment) => (
        <div key={moment.label} className={cn("absolute", moment.place)}>
          <div
            className={cn(
              "w-64 rounded-2xl border border-stage-line bg-stage-card p-4 shadow-2xl motion-safe:animate-[drift_7s_ease-in-out_infinite]",
              moment.tilt,
              moment.delay,
            )}
          >
            <p className="flex items-center gap-2 text-xs font-semibold text-brand">
              <span className="size-1.5 rounded-full bg-brand" />
              {moment.label}
            </p>
            <p className="mt-2 font-tabular text-2xl font-semibold tracking-tight">{moment.amount}</p>
            <p className="mt-0.5 text-xs text-stage-muted">{moment.detail}</p>
          </div>
        </div>
      ))}

      <div className="absolute top-[8%] right-[14%] grid size-24 rotate-12 place-items-center rounded-full bg-brand p-3 text-center text-[11px] leading-tight font-semibold text-brand-foreground shadow-[0_12px_30px_-10px_color-mix(in_oklch,var(--brand)_60%,transparent)]">
        Clients pay without an account
      </div>

      <div className="absolute inset-x-10 bottom-10">
        <p className="max-w-sm font-[family-name:var(--font-display)] text-4xl leading-[1.05]">
          Quote it. Get paid.
          <br />
          Pay your team.
        </p>
        <p className="mt-3 max-w-sm text-sm text-stage-muted">
          Payleor keeps the money moving between your clients, your team and PayPal.
        </p>
      </div>
    </div>
  );
}
