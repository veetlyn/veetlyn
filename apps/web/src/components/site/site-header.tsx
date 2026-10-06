import { buttonVariants } from "@jendal-workspace/ui/components/button";
import Link from "next/link";

export default function SiteHeader({ adminOrigin }: { adminOrigin: string }) {
  return (
    <header className="border-b">
      <div className="container mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Payleor
        </Link>
        <nav aria-label="Main" className="flex items-center gap-4 text-sm sm:gap-5">
          <a href="/#products" className="underline-offset-4 hover:underline">
            Products
          </a>
          <a href="/#pricing" className="underline-offset-4 hover:underline">
            Pricing
          </a>
          <a href={`${adminOrigin}/login`} className="underline-offset-4 hover:underline">
            Log in
          </a>
          <a href={`${adminOrigin}/signup`} className={buttonVariants({ size: "sm" })}>
            Get started
          </a>
        </nav>
      </div>
    </header>
  );
}
