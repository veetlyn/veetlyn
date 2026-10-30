import type { Metadata } from "next";

import LegalPage from "@/components/legal/legal-page";
import { legalMdxComponents } from "@/components/legal/mdx-components";
import AcceptableUse from "@/content/legal/acceptable-use.mdx";
import { LEGAL_LAST_UPDATED } from "@/content/legal/meta";
import { platformSite } from "@/lib/platform";
import { pageMetadata } from "@/lib/site/seo";

export function generateMetadata(): Metadata {
  const site = platformSite();
  return pageMetadata({ path: "/legal/acceptable-use", title: `Acceptable use policy · ${site.name}`, description: `What ${site.name} may not be used to sell or do.`, site });
}

export default function AcceptableUsePage() {
  return (
    <LegalPage title="Acceptable use policy" updatedOn={LEGAL_LAST_UPDATED}>
      <AcceptableUse components={legalMdxComponents} />
    </LegalPage>
  );
}
