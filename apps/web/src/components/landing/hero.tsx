import { buttonFlat } from "./styles";
import HeroSplit from "./hero-split";

const BAND = Array.from({ length: 14 }, (_, i) => i);

export default function Hero({ signupUrl, loginUrl, demoUrl }: { signupUrl: string; loginUrl: string; demoUrl: string | null }) {
  return (
    <section aria-labelledby="hero-heading" className="grid grid-cols-[minmax(0,1fr)] gap-4 p-4 lg:grid-cols-2 lg:h-[calc(100svh-5.5rem)] lg:min-h-[640px]">
      <div className="order-2 flex flex-col bg-field-1 text-field-1-ink lg:order-1">
        <div aria-hidden="true" className="flex h-10 gap-2 overflow-hidden px-6 pt-6 lg:h-14 lg:px-8 lg:pt-8">
          {BAND.map((i) => (
            <span key={i} className={`h-full w-7 shrink-0 bowl ${i === 3 ? "bg-brand" : "bg-field-1-ink"}`} />
          ))}
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-14 text-center lg:px-10">
          <h1
            id="hero-heading"
            className="max-w-[13ch] font-heading text-[clamp(40px,4.6vw,80px)] leading-[0.98] text-balance"
          >
            Quote, get paid, pay your team.
          </h1>
          <p className="mt-8 max-w-[36ch] text-[17px] leading-relaxed">
            Payleor runs the money around client work. Your client pays through PayPal with no account to make, and
            everyone on the project gets their share.
          </p>
          <a
            href={signupUrl}
            className={`${buttonFlat} mt-10`}
          >
            Start a workspace
          </a>
        </div>
        <nav aria-label="Hero" className="flex flex-wrap justify-center gap-x-8 gap-y-2 px-6 pb-7 text-[15px]">
          <a href="/pricing" className="underline decoration-current/30 underline-offset-4 hover:decoration-current">
            See pricing
          </a>
          <a href="#money" className="underline decoration-current/30 underline-offset-4 hover:decoration-current">
            How the money moves
          </a>
          <a href={demoUrl ?? loginUrl} className="underline decoration-current/30 underline-offset-4 hover:decoration-current">
            {demoUrl ? "See a demo store" : "Log in"}
          </a>
        </nav>
      </div>

      <div className="relative order-1 flex h-[64svh] min-h-[540px] items-center justify-center overflow-hidden bg-stage px-4 lg:order-2 lg:h-auto">
        <div aria-hidden="true" className="absolute inset-y-[8%] left-[6%] w-[78%]">
          <span className="absolute top-0 bottom-[-20%] left-0 w-[22%] bg-stage-card" />
          <span className="absolute top-0 left-[24%] h-[58%] w-[76%] bg-stage-card bowl" />
          <span className="absolute bottom-[4%] left-[30%] size-[13%] max-h-16 max-w-16 bg-brand" />
        </div>
        <div className="relative w-full max-w-[420px] lg:ml-[18%]">
          <HeroSplit />
        </div>
      </div>
    </section>
  );
}
