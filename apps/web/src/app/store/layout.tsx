import { policiesFor } from "@jendal-workspace/core";
import Link from "next/link";

import { SELLER_POLICY_PAGES } from "@/content/seller-policies";
import { STORE_POLICY_PAGES } from "@/content/store-policies";
import { fetchStoreInfo, getPlatformOrigins } from "@/lib/server-api";

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const info = await fetchStoreInfo();
  if (!info) return children;

  const { site } = await getPlatformOrigins();
  const pages = info.product === "services" ? SELLER_POLICY_PAGES : STORE_POLICY_PAGES;
  const payleorLinks = [
    { href: `${site}/legal/terms`, label: "Payleor terms" },
    { href: `${site}/legal/privacy`, label: "Payleor privacy" },
    { href: `${site}/legal/acceptable-use`, label: "Acceptable use" },
  ];

  return (
    <>
      <div className="flex-1">{children}</div>
      <footer className="border-t">
        <div className="container mx-auto flex max-w-5xl flex-col gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <nav aria-label="Store policies" className="flex flex-wrap gap-x-5 gap-y-2">
            {policiesFor(info.product).map((policy) => (
              <Link key={policy} href={`/policies/${policy}`} className="hover:text-foreground">
                {pages[policy]?.title}
              </Link>
            ))}
          </nav>
          <nav aria-label="Payleor" className="flex flex-wrap gap-x-5 gap-y-2">
            <a href={site} className="hover:text-foreground">
              Powered by Payleor
            </a>
            {payleorLinks.map(({ href, label }) => (
              <a key={href} href={href} className="hover:text-foreground">
                {label}
              </a>
            ))}
          </nav>
        </div>
      </footer>
    </>
  );
}
