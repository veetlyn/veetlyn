import type { Metadata } from "next";

import LegalPage from "@/components/legal/legal-page";
import { legalMdxComponents } from "@/components/legal/mdx-components";
import { LEGAL_LAST_UPDATED } from "@/content/legal/meta";
import Terms from "@/content/legal/terms.mdx";
import { platformName } from "@/lib/platform";

export function generateMetadata(): Metadata {
  return { title: `Terms of service · ${platformName()}` };
}

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updatedOn={LEGAL_LAST_UPDATED}>
      <Terms components={legalMdxComponents} />
    </LegalPage>
  );
}
