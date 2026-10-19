// The right half of the sign-in pages: one project's money, laid out like a statement on a dark stage.
// Decorative only; everything a person needs is in the form beside it.
const STEPS = [
  { label: "Quote accepted", detail: "Logo and brand kit", amount: "$640.00", when: "Mon" },
  { label: "Deposit paid with PayPal", detail: "Half up front", amount: "$320.00", when: "Tue" },
  { label: "Delivery accepted", detail: "Balance paid", amount: "$320.00", when: "Fri" },
  { label: "Payout sent", detail: "To Amadou, designer", amount: "$272.00", when: "Fri" },
] as const;

export default function AuthVisual() {
  return (
    <div aria-hidden="true" className="relative hidden overflow-hidden rounded-[18px] bg-stage text-stage-ink lg:block">
      <div className="absolute inset-0 bg-[linear-gradient(var(--stage-line)_1px,transparent_1px),linear-gradient(90deg,var(--stage-line)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_50%_40%,black_20%,transparent_75%)]" />

      <div className="absolute inset-x-[12%] top-[12%] rounded-xl border border-stage-line bg-stage-card shadow-2xl">
        <div className="flex items-baseline justify-between border-b border-stage-line px-5 py-4">
          <div>
            <p className="text-xs text-stage-muted">Project</p>
            <p className="mt-0.5 text-sm font-medium">Logo and brand kit</p>
          </div>
          <p className="text-xs font-medium text-brand">Completed</p>
        </div>
        <ol className="divide-y divide-stage-line">
          {STEPS.map((step) => (
            <li key={step.label} className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-baseline gap-3 px-5 py-3.5">
              <span className="text-xs text-stage-muted">{step.when}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm">{step.label}</span>
                <span className="block truncate text-xs text-stage-muted">{step.detail}</span>
              </span>
              <span className="font-tabular text-sm">{step.amount}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="absolute inset-x-[12%] bottom-[9%]">
        <p className="max-w-md font-heading text-[2rem] leading-[1.1]">
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
