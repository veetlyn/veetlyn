import BlogTopics from "@/components/site/blog-topics";
import CloseCta from "@/components/site/close-cta";
import JsonLd from "@/components/site/json-ld";
import { posts } from "@/content/blog/posts";
import { platformSite } from "@/lib/platform";
import { absoluteUrl, breadcrumbs, graph, organization, pageMetadata } from "@/lib/site/seo";

const DESCRIPTION =
  "Plain guides for people who sell their work: how AI shopping works, how to get paid with PayPal, and how to get found on Google and in AI answers.";

export function generateMetadata() {
  const site = platformSite();
  return pageMetadata({ path: "/blog", title: `The ${site.name} blog`, description: DESCRIPTION, site });
}

export default function BlogPage() {
  const site = platformSite();
  const org = organization(site);
  const blogUrl = absoluteUrl("/blog", site.domain);
  return (
    <>
      <JsonLd
        data={graph(org, breadcrumbs([["Blog", "/blog"]], site), {
          "@type": "Blog",
          "@id": `${blogUrl}#blog`,
          url: blogUrl,
          name: `The ${site.name} blog`,
          description: DESCRIPTION,
          publisher: { "@id": org["@id"] },
          blogPost: posts(site).map((p) => ({
            "@type": "BlogPosting",
            headline: p.title,
            url: absoluteUrl(`/blog/${p.slug}`, site.domain),
            datePublished: p.date,
          })),
        })}
      />
      <BlogTopics>
        <CloseCta />
      </BlogTopics>
    </>
  );
}
