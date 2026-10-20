import { env } from "cloudflare:workers";

import { sandboxBannerContent } from "@/lib/sandbox-banner";

// Rendered by the root layout on every host. It cannot be dismissed (spec §4.3).
export default function SandboxBanner() {
  const content = sandboxBannerContent("default", env);
  if (!content) return null;
  return (
    <aside
      aria-label="Sandbox notice"
      className="sticky top-0 z-50 bg-tray px-4 py-1.5 text-center text-[13px] font-medium text-muted-foreground"
    >
      <p>{content.text}</p>
    </aside>
  );
}
