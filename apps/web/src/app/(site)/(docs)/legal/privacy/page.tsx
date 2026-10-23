import type { Metadata } from "next";

import LegalPage from "@/components/legal/legal-page";
import { legalMdxComponents } from "@/components/legal/mdx-components";
import { LEGAL_LAST_UPDATED } from "@/content/legal/meta";
import Privacy from "@/content/legal/privacy.mdx";
import { platformName } from "@/lib/platform";

export function generateMetadata(): Metadata {
  return { title: `Privacy policy · ${platformName()}` };
}

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updatedOn={LEGAL_LAST_UPDATED}>
      <Privacy components={legalMdxComponents} />
    </LegalPage>
  );
}
