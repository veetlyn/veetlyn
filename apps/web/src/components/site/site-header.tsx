import Link from "next/link";

import { BrandLockup } from "@/components/brand-mark";

export default function SiteHeader({ dashOrigin }: { dashOrigin: string }) {
  return (
    <header className="bg-background">
      <div className="flex w-full items-center justify-between gap-4 px-5 py-4 md:px-8">
        <Link href="/" aria-label="Payleor home">
          <BrandLockup />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-3 text-sm sm:gap-5">
          <a href="/#money" className="hidden text-muted-foreground hover:text-foreground sm:inline">
            How it works
          </a>
          <a href="/pricing" className="text-muted-foreground hover:text-foreground">
            Pricing
          </a>
          <a href={`${dashOrigin}/login`} className="text-muted-foreground hover:text-foreground">
            Log in
          </a>
          <a href={`${dashOrigin}/signup`} className="press inline-flex h-9 items-center bg-foreground px-4 text-sm font-medium text-background bowl hover:bg-foreground/90">
            Get started
          </a>
        </nav>
      </div>
    </header>
  );
}
