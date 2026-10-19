import { buttonVariants } from "@jendal-workspace/ui/lib/button-variants";
import Link from "next/link";

import { BrandLockup } from "@/components/brand-mark";

export default function SiteHeader({ dashOrigin }: { dashOrigin: string }) {
  return (
    <header className="border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 md:px-7">
        <Link href="/" aria-label="Payleor home">
          <BrandLockup />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-3 text-sm sm:gap-5">
          <a href="/#products" className="hidden text-muted-foreground hover:text-foreground sm:inline">
            Products
          </a>
          <a href="/#pricing" className="text-muted-foreground hover:text-foreground">
            Pricing
          </a>
          <a href={`${dashOrigin}/login`} className="text-muted-foreground hover:text-foreground">
            Log in
          </a>
          <a href={`${dashOrigin}/signup`} className={buttonVariants({ size: "sm" })}>
            Get started
          </a>
        </nav>
      </div>
    </header>
  );
}
