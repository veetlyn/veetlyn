import { env } from "cloudflare:workers";

import { sandboxBannerContent } from "@/lib/sandbox-banner";

// Rendered by the root layout on every host. It cannot be dismissed (spec §4.3).
export default function SandboxBanner({ variant = "default" }: { variant?: "default" | "checkout" }) {
  const content = sandboxBannerContent(variant, env);
  return (
    <aside
      aria-label="Sandbox notice"
      className="sticky top-0 z-50 border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50"
    >
      <p>{content.text}</p>
      {content.kind === "checkout" ? (
        <dl className="mt-1 flex flex-wrap justify-center gap-x-6 gap-y-1 text-xs">
          <div className="flex gap-2">
            <dt className="font-medium">PayPal buyer</dt>
            <dd className="font-mono">
              {content.buyer.email} / {content.buyer.password}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium">Test card</dt>
            <dd className="font-mono">
              {content.card.number} · {content.card.expiry} · CVV {content.card.cvv}
            </dd>
          </div>
        </dl>
      ) : null}
    </aside>
  );
}
