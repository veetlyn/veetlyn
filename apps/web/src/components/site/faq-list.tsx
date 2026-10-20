import Link from "next/link";

import { type Faq, faqAnswerText } from "@/content/site/faqs";
import { faqPage } from "@/lib/site/seo";

export const faqStructuredData = (items: readonly Faq[]) =>
  faqPage(items.map((f) => ({ q: f.q, a: faqAnswerText(f) })));

export function FaqItems({ items }: { items: readonly Faq[] }) {
  return items.map((f, i) => (
    <details key={f.q} open={i === 0}>
      <summary>{f.q}</summary>
      <p>
        {f.a}
        {f.link && (
          <>
            {" "}
            <Link href={f.link.href}>{f.link.label}</Link>.
          </>
        )}
      </p>
    </details>
  ));
}

export default function FaqList({ title, items }: { title: string; items: readonly Faq[] }) {
  return (
    <section aria-labelledby="faq-h">
      <div className="wrap faq">
        <h2 id="faq-h" data-in>
          {title}
        </h2>
        <div data-in>
          <FaqItems items={items} />
        </div>
      </div>
    </section>
  );
}
