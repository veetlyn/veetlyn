import { STORE_POLICIES } from "@jendal-workspace/core";
import Link from "next/link";

import { STORE_POLICY_PAGES } from "@/content/store-policies";

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="flex-1">{children}</div>
      <footer className="border-t">
        <div className="container mx-auto flex max-w-5xl flex-col gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <nav aria-label="Store policies" className="flex flex-wrap gap-x-5 gap-y-2">
            {STORE_POLICIES.map((policy) => (
              <Link key={policy} href={`/policies/${policy}`} className="hover:text-foreground">
                {STORE_POLICY_PAGES[policy].title}
              </Link>
            ))}
          </nav>
          <p>Powered by Payleor</p>
        </div>
      </footer>
    </>
  );
}
