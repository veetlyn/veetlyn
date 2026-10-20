import BlogTopics from "@/components/site/blog-topics";
import CloseCta from "@/components/site/close-cta";
import JsonLd from "@/components/site/json-ld";
import { POSTS } from "@/content/blog/posts";
import { absoluteUrl, breadcrumbs, graph, organization, pageMetadata } from "@/lib/site/seo";

const DESCRIPTION =
  "Plain guides for people who sell their work: how AI shopping works, how to get paid with PayPal, and how to get found on Google and in AI answers.";

export const metadata = pageMetadata({ path: "/blog", title: "The Payleor blog", description: DESCRIPTION });

export default function BlogPage() {
  return (
    <>
      <JsonLd
        data={graph(organization(), breadcrumbs([["Blog", "/blog"]]), {
          "@type": "Blog",
          "@id": `${absoluteUrl("/blog")}#blog`,
          url: absoluteUrl("/blog"),
          name: "The Payleor blog",
          description: DESCRIPTION,
          publisher: { "@id": organization()["@id"] },
          blogPost: POSTS.map((p) => ({
            "@type": "BlogPosting",
            headline: p.title,
            url: absoluteUrl(`/blog/${p.slug}`),
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
