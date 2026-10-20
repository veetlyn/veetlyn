import { describe, expect, it } from "vitest";

import { breadcrumbs, faqPage, pageMetadata, SITE_ORIGIN } from "./seo";

describe("pageMetadata", () => {
  it("sets the description, the canonical URL and Open Graph from one call", () => {
    const m = pageMetadata({ path: "/network", title: "Payleor Network", description: "The connector." });
    expect(m.alternates?.canonical).toBe(`${SITE_ORIGIN}/network`);
    expect(m.openGraph).toMatchObject({ title: "Payleor Network", url: `${SITE_ORIGIN}/network`, siteName: "Payleor" });
    expect(m.description).toBe("The connector.");
  });
});

describe("JSON-LD", () => {
  it("lists breadcrumbs from home with absolute URLs", () => {
    expect(
      breadcrumbs([
        ["Blog", "/blog"],
        ["A post", "/blog/a"],
      ]).itemListElement,
    ).toEqual([
      { "@type": "ListItem", position: 1, name: "Payleor", item: `${SITE_ORIGIN}/` },
      { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE_ORIGIN}/blog` },
      { "@type": "ListItem", position: 3, name: "A post", item: `${SITE_ORIGIN}/blog/a` },
    ]);
  });

  it("turns question and answer pairs into a FAQPage", () => {
    expect(faqPage([{ q: "Does Payleor hold my money?", a: "No." }])).toEqual({
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "Does Payleor hold my money?", acceptedAnswer: { "@type": "Answer", text: "No." } },
      ],
    });
  });
});
