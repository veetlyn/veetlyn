import { buttonVariants } from "@jendal-workspace/ui/lib/button-variants";
import { Check } from "lucide-react";

const INCLUDED = [
  "Projects, quotes, amendments and deliveries",
  "Client pay pages with PayPal, no client account needed",
  "Freelancer payouts by approval, by rule or automatically",
  "A public API, outgoing webhooks and a Discord bot",
  "Cases and disputes, with templates you set up",
];

export default function PayoutsPricing({ signupUrl }: { signupUrl: string }) {
  return (
    <div className="grid gap-8 panel p-6 md:grid-cols-2">
      <div>
        <p className="text-4xl font-semibold tabular-nums">0.5% + 0.10</p>
        <p className="mt-1 text-sm text-muted-foreground">
          per client payment, in your team's currency (USD or EUR)
        </p>
        <p className="mt-4 text-sm font-medium">Plus a plan. Plan prices are coming soon.</p>
        <a href={signupUrl} className={`${buttonVariants({ size: "lg" })} mt-6`}>
          Get started
        </a>
      </div>
      <ul className="space-y-2 text-sm">
        {INCLUDED.map((item) => (
          <li key={item} className="flex gap-2">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
