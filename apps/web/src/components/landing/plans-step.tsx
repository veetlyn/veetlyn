import { SELLER_PLANS } from "@jendal-workspace/core";

const HEIGHTS = ["lg:h-[360px]", "lg:h-[480px]", "lg:h-[600px]"] as const;
const TONES = [
  "bg-field-2 text-field-2-ink",
  "bg-field-3 text-field-3-ink",
  "bg-field-4 text-field-4-ink",
] as const;

const percent = (bps: number) => `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

// The bigger plan is literally bigger: tile heights step up like a bar chart.
export default function PlansStep({ signupUrl }: { signupUrl: string }) {
  return (
    <section id="plans" aria-labelledby="plans-heading" className="scroll-mt-4 px-4">
      <div className="relative grid grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-3 lg:items-end">
        <div className="mb-8 lg:absolute lg:top-0 lg:left-0 lg:mb-0 lg:w-[32%] lg:pl-6">
          <h2 id="plans-heading" data-reveal className="font-heading text-[clamp(36px,4vw,64px)] leading-[1]">
            One plan, small fee
          </h2>
          <p data-reveal style={{ "--i": 1 }} className="mt-5 max-w-[48ch] text-[17px] leading-relaxed">
            A flat plan and a small fee on each client payment. Nothing on clients you bring yourself.{" "}
            <a href="/pricing" className="underline decoration-current/30 underline-offset-4 hover:decoration-current">
              Full pricing
            </a>
          </p>
        </div>
        {SELLER_PLANS.map((plan, i) => (
          <article
            key={plan.id}
            data-reveal
            style={{ "--i": i }}
            className={`flex flex-col ${TONES[i] ?? TONES[0]} ${HEIGHTS[i] ?? ""}`}
          >
            <div className="flex-1 p-7">
              <h3 className="font-heading text-[24px]">{plan.name}</h3>
              <p className="mt-2 font-heading font-tabular text-[clamp(36px,4vw,64px)] leading-none">
                ${plan.priceCents.monthly / 100}
                <span className="font-sans text-[17px] font-normal"> a month</span>
              </p>
              <ul className="mt-6 grid gap-1.5 text-[17px]">
                <li>{percent(plan.feeBps)} on each client payment</li>
                {plan.highlights.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <a
              href={signupUrl}
              className="press flex h-16 items-center bg-black/15 px-7 text-[17px] font-medium hover:bg-black/25 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring"
            >
              Start with {plan.name}
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}
