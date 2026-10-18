import { env } from "cloudflare:workers";

import { sandboxBannerContent } from "@/lib/sandbox-banner";

// Beside the PayPal buttons on checkout pages: the sandbox buyer login and test card to pay with.
export default function SandboxCheckoutHelp() {
  const content = sandboxBannerContent("checkout", env);
  if (content?.kind !== "checkout") return null;
  return (
    <section
      aria-label="Sandbox test payment details"
      className="mx-auto w-full max-w-xl rounded-xl bg-tray p-4 text-sm text-foreground shadow-[inset_0_0_0_1px_var(--border)]"
    >
      <p className="font-medium">Pay with a sandbox test account</p>
      <dl className="mt-2 grid gap-1 text-xs">
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium">PayPal buyer</dt>
          <dd className="font-mono break-all">
            {content.buyer.email} / {content.buyer.password}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium">Test card</dt>
          <dd className="font-mono">
            {content.card.number} · {content.card.expiry} · CVV {content.card.cvv}
          </dd>
        </div>
      </dl>
    </section>
  );
}
