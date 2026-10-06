import type { Metadata } from "next";

import LegalPage from "@/components/legal/legal-page";
import { legalMdxComponents } from "@/components/legal/mdx-components";
import { LEGAL_LAST_UPDATED } from "@/content/legal/meta";
import Terms from "@/content/legal/terms.mdx";

export const metadata: Metadata = { title: "Terms of Service · Payleor" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updatedOn={LEGAL_LAST_UPDATED}>
      <Terms components={legalMdxComponents} />
    </LegalPage>
  );
}
