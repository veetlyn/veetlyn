import type { Metadata } from "next";

import LegalPage from "@/components/legal/legal-page";
import { legalMdxComponents } from "@/components/legal/mdx-components";
import { LEGAL_LAST_UPDATED } from "@/content/legal/meta";
import Terms from "@/content/legal/terms.mdx";
import { platformSite } from "@/lib/platform";
import { pageMetadata } from "@/lib/site/seo";

export function generateMetadata(): Metadata {
  const site = platformSite();
  return pageMetadata({ path: "/legal/terms", title: `Terms of service · ${site.name}`, description: `The terms for using ${site.name}: accounts, payments through PayPal, fees and responsibilities.`, site });
}

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updatedOn={LEGAL_LAST_UPDATED}>
      <Terms components={legalMdxComponents} />
    </LegalPage>
  );
}
