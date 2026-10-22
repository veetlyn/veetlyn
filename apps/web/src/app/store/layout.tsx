import { policiesFor, type StorePolicy } from "@jendal-workspace/core";
import Link from "next/link";

import { SELLER_POLICY_PAGES } from "@/content/seller-policies";
import { STORE_POLICY_PAGES } from "@/content/store-policies";
import { platformName } from "@/lib/platform";
import { fetchStoreInfo, getPlatformOrigins } from "@/lib/server-api";

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const info = await fetchStoreInfo();
  if (!info) return children;

  const { site } = await getPlatformOrigins();
  const name = platformName();
  const pageFor = (policy: StorePolicy) =>
    info.product === "services" ? SELLER_POLICY_PAGES.get(policy) : STORE_POLICY_PAGES[policy];
  const platformLinks = [
    { href: `${site}/legal/terms`, label: `${name} terms` },
    { href: `${site}/legal/privacy`, label: `${name} privacy` },
    { href: `${site}/legal/acceptable-use`, label: "Acceptable use" },
  ];

  return (
    <>
      <div className="flex-1">{children}</div>
      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-6 md:px-7 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <nav aria-label="Store policies" className="flex flex-wrap gap-x-5 gap-y-2">
            {policiesFor(info.product).map((policy) => (
              <Link key={policy} href={`/policies/${policy}`} className="hover:text-foreground">
                {pageFor(policy)?.title}
              </Link>
            ))}
          </nav>
          <nav aria-label={name} className="flex flex-wrap gap-x-5 gap-y-2">
            <a href={site} className="hover:text-foreground">
              Powered by {name}
            </a>
            {platformLinks.map(({ href, label }) => (
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
