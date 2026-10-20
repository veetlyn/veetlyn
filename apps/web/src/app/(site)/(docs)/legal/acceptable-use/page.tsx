import type { Metadata } from "next";

import LegalPage from "@/components/legal/legal-page";
import { legalMdxComponents } from "@/components/legal/mdx-components";
import AcceptableUse from "@/content/legal/acceptable-use.mdx";
import { LEGAL_LAST_UPDATED } from "@/content/legal/meta";

export const metadata: Metadata = { title: "Acceptable use policy · Payleor" };

export default function AcceptableUsePage() {
  return (
    <LegalPage title="Acceptable use policy" updatedOn={LEGAL_LAST_UPDATED}>
      <AcceptableUse components={legalMdxComponents} />
    </LegalPage>
  );
}
