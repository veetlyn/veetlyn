import Link from "next/link";

import { CONTACT_EMAIL } from "@/content/legal/meta";

export default function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8 md:px-7 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/legal/terms" className="hover:text-foreground">
            Terms of service
          </Link>
          <Link href="/legal/privacy" className="hover:text-foreground">
            Privacy policy
          </Link>
          <Link href="/legal/acceptable-use" className="hover:text-foreground">
            Acceptable use policy
          </Link>
        </nav>
        <p>
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-foreground">
            {CONTACT_EMAIL}
          </a>{" "}
          · © 2026 Payleor
        </p>
      </div>
    </footer>
  );
}
