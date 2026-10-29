import type { Metadata } from "next";

import LegalPage from "@/components/legal/legal-page";
import { legalMdxComponents } from "@/components/legal/mdx-components";
import { LEGAL_LAST_UPDATED } from "@/content/legal/meta";
import Privacy from "@/content/legal/privacy.mdx";
import { platformSite } from "@/lib/platform";
import { pageMetadata } from "@/lib/site/seo";

export function generateMetadata(): Metadata {
  const site = platformSite();
  return pageMetadata({ path: "/legal/privacy", title: `Privacy policy · ${site.name}`, description: `What personal data ${site.name} collects, why, who it is shared with and how to exercise your rights.`, site });
}

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updatedOn={LEGAL_LAST_UPDATED}>
      <Privacy components={legalMdxComponents} />
    </LegalPage>
  );
}
