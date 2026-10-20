import type { Metadata } from "next";

export const SITE_ORIGIN = "https://payleor.com";
const ORG_ID = `${SITE_ORIGIN}/#org`;

export const absoluteUrl = (path: string) => `${SITE_ORIGIN}${path}`;

export function pageMetadata(p: {
  path: string;
  title: string;
  description: string;
  kind?: "website" | "article";
}): Metadata {
  const url = absoluteUrl(p.path);
  return {
    title: p.title,
    description: p.description,
    alternates: { canonical: url },
    openGraph: { title: p.title, description: p.description, url, siteName: "Payleor", type: p.kind ?? "website" },
    twitter: { card: "summary", title: p.title, description: p.description },
  };
}

export const organization = () =>
  ({
    "@type": "Organization",
    "@id": ORG_ID,
    name: "Payleor",
    url: absoluteUrl("/"),
    email: "contact@payleor.com",
  }) as const;

export const websiteWithSearch = () =>
  ({
    "@type": "WebSite",
    "@id": `${SITE_ORIGIN}/#site`,
    url: absoluteUrl("/"),
    name: "Payleor",
    publisher: { "@id": ORG_ID },
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_ORIGIN}/discover?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  }) as const;

export function breadcrumbs(trail: ReadonlyArray<readonly [name: string, path: string]>) {
  const all: ReadonlyArray<readonly [string, string]> = [["Payleor", "/"], ...trail];
  return {
    "@type": "BreadcrumbList" as const,
    itemListElement: all.map(([name, path], i) => ({
      "@type": "ListItem" as const,
      position: i + 1,
      name,
      item: absoluteUrl(path),
    })),
  };
}

export function faqPage(items: ReadonlyArray<{ q: string; a: string }>) {
  return {
    "@type": "FAQPage" as const,
    mainEntity: items.map(({ q, a }) => ({
      "@type": "Question" as const,
      name: q,
      acceptedAnswer: { "@type": "Answer" as const, text: a },
    })),
  };
}

export function blogPosting(p: {
  slug: string;
  title: string;
  description: string;
  date: string;
  section: string;
  words: number;
}) {
  const url = absoluteUrl(`/blog/${p.slug}`);
  return {
    "@type": "BlogPosting" as const,
    "@id": `${url}#post`,
    headline: p.title,
    description: p.description,
    datePublished: p.date,
    dateModified: p.date,
    url,
    mainEntityOfPage: url,
    articleSection: p.section,
    wordCount: p.words,
    inLanguage: "en",
    author: { "@id": ORG_ID },
    publisher: { "@id": ORG_ID },
  };
}

export const graph = (...nodes: object[]) => ({ "@context": "https://schema.org", "@graph": nodes });
