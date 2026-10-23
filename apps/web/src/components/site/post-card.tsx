"use client";

import Link from "next/link";

import { usePlatformName } from "@/components/platform-name";
import ArticleArt from "@/components/site/art/article";
import { categoryLabel, type Post, readingMinutes } from "@/content/blog/posts";

export default function PostCard({ post, feature = false, hidden }: { post: Post; feature?: boolean; hidden?: boolean }) {
  const Heading = feature ? "h2" : "h3";
  const labels = categoryLabel(usePlatformName());
  return (
    <Link className={feature ? "post-feature" : "post-card"} data-in href={`/blog/${post.slug}`} hidden={hidden}>
      <div className="art">
        <ArticleArt name={post.art} />
      </div>
      <div className="txt">
        <p className="post-cat">{labels[post.category]}</p>
        <Heading>{post.title}</Heading>
        <p className="post-lead">{post.lead}</p>
        <p className="post-time">{readingMinutes(post)} min read</p>
      </div>
    </Link>
  );
}
