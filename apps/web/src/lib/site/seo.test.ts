import { describe, expect, it } from "vitest";

import { breadcrumbs, faqPage, pageMetadata, siteOrigin } from "./seo";

const SITE = { name: "Platform", domain: "platform.test" };
const origin = siteOrigin(SITE.domain);

describe("pageMetadata", () => {
  it("sets the description, the canonical URL and Open Graph from one call", () => {
    const m = pageMetadata({ path: "/network", title: "Platform Network", description: "The connector.", site: SITE });
    expect(m.alternates?.canonical).toBe(`${origin}/network`);
    expect(m.openGraph).toMatchObject({ title: "Platform Network", url: `${origin}/network`, siteName: "Platform" });
    expect(m.description).toBe("The connector.");
  });
});

describe("JSON-LD", () => {
  it("lists breadcrumbs from home with absolute URLs", () => {
    expect(
      breadcrumbs(
        [
          ["Blog", "/blog"],
          ["A post", "/blog/a"],
        ],
        SITE,
      ).itemListElement,
    ).toEqual([
      { "@type": "ListItem", position: 1, name: "Platform", item: `${origin}/` },
      { "@type": "ListItem", position: 2, name: "Blog", item: `${origin}/blog` },
      { "@type": "ListItem", position: 3, name: "A post", item: `${origin}/blog/a` },
    ]);
  });

  it("turns question and answer pairs into a FAQPage", () => {
    expect(faqPage([{ q: "Does Platform hold my money?", a: "No." }])).toEqual({
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "Does Platform hold my money?", acceptedAnswer: { "@type": "Answer", text: "No." } },
      ],
    });
  });
});
