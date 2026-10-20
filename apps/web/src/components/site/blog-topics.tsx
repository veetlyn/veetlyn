"use client";

import { type ReactNode, useEffect, useState } from "react";

import PostCard from "@/components/site/post-card";
import { BLOG_CATEGORIES, type BlogCategory, CATEGORY_LABEL, POSTS } from "@/content/blog/posts";

const isCategory = (v: string): v is BlogCategory => BLOG_CATEGORIES.some((c) => c === v);

// The blog index: one topic at a time, picked by the chips or by the address's #topic.
export default function BlogTopics({ children }: { children: ReactNode }) {
  const [topic, setTopic] = useState<BlogCategory | "all">("all");

  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    if (isCategory(fromHash)) setTopic(fromHash);
  }, []);

  const [first, ...rest] = POSTS;
  const hidden = (category: BlogCategory) => topic !== "all" && topic !== category;
  return (
    <>
      <div className="band">
        <div className="wrap hero page solo">
          <div>
            <h1 data-in>The Payleor blog</h1>
            <p className="lead" data-in>
              Plain guides for people who sell their work: how AI shopping works, how to get paid, and how to get found.
            </p>
            <div className="cat-row" role="group" aria-label="Topic">
              <button type="button" aria-pressed={topic === "all"} onClick={() => setTopic("all")}>
                All
              </button>
              {BLOG_CATEGORIES.map((c) => (
                <button key={c} type="button" aria-pressed={topic === c} onClick={() => setTopic(c)}>
                  {CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div>
        <section aria-label="Articles" style={{ paddingTop: "clamp(40px,5vw,64px)" }}>
          <div className="wrap">
            {first && <PostCard post={first} feature hidden={hidden(first.category)} />}
            <div className="posts">
              {rest.map((p) => (
                <PostCard key={p.slug} post={p} hidden={hidden(p.category)} />
              ))}
            </div>
          </div>
        </section>
        {children}
      </div>
    </>
  );
}
