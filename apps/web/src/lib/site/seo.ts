import type { Metadata } from "next";

export type SeoSite = { name: string; domain: string };

export const siteOrigin = (domain: string) => `https://${domain}`;
const orgId = (domain: string) => `${siteOrigin(domain)}/#org`;

export const absoluteUrl = (path: string, domain: string) => `${siteOrigin(domain)}${path}`;

export function pageMetadata(p: {
  path: string;
  title: string;
  description: string;
  kind?: "website" | "article";
  site: SeoSite;
}): Metadata {
  const { site } = p;
  const url = absoluteUrl(p.path, site.domain);
  return {
    title: p.title,
    description: p.description,
    alternates: { canonical: url },
    openGraph: { images: [{ url: absoluteUrl("/og.png", site.domain), width: 1200, height: 630, alt: `${site.name}: Sell where clients ask AI.` }], title: p.title, description: p.description, url, siteName: site.name, type: p.kind ?? "website" },
    twitter: { card: "summary_large_image", images: [absoluteUrl("/og.png", site.domain)], title: p.title, description: p.description },
  };
}

export const organization = (site: SeoSite) =>
  ({
    "@type": "Organization",
    "@id": orgId(site.domain),
    name: site.name,
    url: absoluteUrl("/", site.domain),
    email: `contact@${site.domain}`,
    logo: absoluteUrl("/favicon/web-app-manifest-512x512.png", site.domain),
  }) as const;

export const websiteWithSearch = (site: SeoSite) =>
  ({
    "@type": "WebSite",
    "@id": `${siteOrigin(site.domain)}/#site`,
    url: absoluteUrl("/", site.domain),
    name: site.name,
    publisher: { "@id": orgId(site.domain) },
    potentialAction: {
      "@type": "SearchAction",
      target: `${siteOrigin(site.domain)}/discover?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  }) as const;

export function breadcrumbs(trail: ReadonlyArray<readonly [name: string, path: string]>, site: SeoSite) {
  const all: ReadonlyArray<readonly [string, string]> = [[site.name, "/"], ...trail];
  return {
    "@type": "BreadcrumbList" as const,
    itemListElement: all.map(([name, path], i) => ({
      "@type": "ListItem" as const,
      position: i + 1,
      name,
      item: absoluteUrl(path, site.domain),
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
  updated?: string;
  section: string;
  words: number;
  domain: string;
}) {
  const url = absoluteUrl(`/blog/${p.slug}`, p.domain);
  return {
    "@type": "BlogPosting" as const,
    "@id": `${url}#post`,
    headline: p.title,
    description: p.description,
    datePublished: p.date,
    dateModified: p.updated ?? p.date,
    url,
    mainEntityOfPage: url,
    articleSection: p.section,
    wordCount: p.words,
    inLanguage: "en",
    author: { "@id": orgId(p.domain) },
    publisher: { "@id": orgId(p.domain) },
  };
}

export const graph = (...nodes: object[]) => ({ "@context": "https://schema.org", "@graph": nodes });
