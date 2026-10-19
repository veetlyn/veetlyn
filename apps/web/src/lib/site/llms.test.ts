import { describe, expect, it } from "vitest";

import { POSTS } from "../../content/blog/posts";
import { llmsTxt, sitePaths } from "./llms";

describe("llms.txt", () => {
  it("summarises Payleor and links every page and article with absolute URLs", () => {
    const txt = llmsTxt();
    expect(txt.startsWith("# Payleor\n\n> ")).toBe(true);
    expect(txt).toContain("https://payleor.com/network");
    for (const p of POSTS) expect(txt).toContain(`https://payleor.com/blog/${p.slug}`);
  });
  it("never claims sellers are listed in Claude and ChatGPT directories", () => {
    expect(llmsTxt()).not.toMatch(/listed in (Claude|ChatGPT)/i);
  });
});

describe("sitePaths", () => {
  it("covers the site and the blog once each", () => {
    const paths = sitePaths();
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain("/");
    expect(paths).toContain("/blog/stores-sell-in-ai-carts");
  });
});
