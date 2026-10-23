import Link from "next/link";
import { notFound } from "next/navigation";

import { PlatformName } from "@/components/platform-name";
import ArticleArt from "@/components/site/art/article";
import CloseCta from "@/components/site/close-cta";
import { FaqItems, faqStructuredData } from "@/components/site/faq-list";
import JsonLd from "@/components/site/json-ld";
import PostCard from "@/components/site/post-card";
import { POST_BODIES } from "@/content/blog/bodies";
import { categoryLabel, posts, readingMinutes } from "@/content/blog/posts";
import { platformSite } from "@/lib/platform";
import { blogPosting, breadcrumbs, graph, organization, pageMetadata, type SeoSite } from "@/lib/site/seo";

type Params = { params: Promise<{ slug: string }> };

const findPost = (slug: string, site: SeoSite) => posts(site).find((p) => p.slug === slug);

const DATE_LABEL = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });

export function generateStaticParams() {
  return [...POST_BODIES.keys()].map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Params) {
  const site = platformSite();
  const post = findPost((await params).slug, site);
  if (!post) return {};
  return pageMetadata({ path: `/blog/${post.slug}`, title: post.title, description: post.description, kind: "article", site });
}

export default async function ArticlePage({ params }: Params) {
  const site = platformSite();
  const allPosts = posts(site);
  const { slug } = await params;
  const post = allPosts.find((p) => p.slug === slug);
  if (!post) notFound();
  const Body = POST_BODIES.get(post.slug);
  if (!Body) notFound();
  const path = `/blog/${post.slug}`;
  const section = categoryLabel(site.name)[post.category];
  const related = allPosts.filter((p) => p !== post).slice(0, 3);
  return (
    <>
      <JsonLd
        data={graph(
          organization(site),
          breadcrumbs(
            [
              ["Blog", "/blog"],
              [post.title, path],
            ],
            site,
          ),
          blogPosting({ ...post, section, domain: site.domain }),
          faqStructuredData(post.faq),
        )}
      />
      <div className="band">
        <div className="wrap hero page solo post-hero">
          <div>
            <nav className="crumbs" aria-label="Breadcrumb">
              <Link href="/blog">Blog</Link>
              <span aria-hidden="true">/</span>
              <Link href={`/blog#${post.category}`}>{section}</Link>
            </nav>
            <h1 data-in>{post.title}</h1>
            <p className="lead" data-in>
              {post.lead}
            </p>
            <p className="post-meta">
              <time dateTime={post.date}>{DATE_LABEL.format(new Date(post.date))}</time> · {readingMinutes(post)} min read ·
              The {site.name} team
            </p>
          </div>
        </div>
      </div>
      <div>
        <article className="post wrap">
          <figure className="post-art" role="img" aria-label={post.title}>
            <ArticleArt name={post.art} />
          </figure>
          <aside className="tldr" aria-label="In short">
            <p className="tldr-h">In short</p>
            <ul>
              {post.short.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </aside>
          <div className="prose">
            <Body components={{ PlatformName }} />
          </div>
          <section className="faq" aria-labelledby="faq-h" style={{ padding: 0 }}>
            <h2 id="faq-h">Questions</h2>
            <div>
              <FaqItems items={post.faq} />
            </div>
          </section>
          <div className="post-cta">
            <p>{post.cta.label}</p>
            <Link className="btn" href={post.cta.href}>
              Read more
            </Link>
          </div>
          <section className="related" aria-labelledby="rel-h" style={{ padding: 0 }}>
            <h2 id="rel-h">Keep reading</h2>
            <div className="posts">
              {related.map((p) => (
                <PostCard key={p.slug} post={p} />
              ))}
            </div>
          </section>
        </article>
        <CloseCta />
      </div>
    </>
  );
}
