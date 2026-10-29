import { describe, expect, it } from "vitest";

import { posts } from "../../content/blog/posts";
import { llmsTxt, sitePaths } from "./llms";

const SITE = { name: "Platform", domain: "platform.test" };

describe("llms.txt", () => {
  it("summarises the platform and links every page and article with absolute URLs", () => {
    const txt = llmsTxt(SITE);
    expect(txt.startsWith("# Platform\n\n> ")).toBe(true);
    expect(txt).toContain("https://platform.test/network");
    for (const p of posts(SITE)) expect(txt).toContain(`https://platform.test/blog/${p.slug}`);
  });
  it("never claims sellers are listed in Claude and ChatGPT directories", () => {
    expect(llmsTxt(SITE)).not.toMatch(/listed in (Claude|ChatGPT)/i);
  });
});

describe("sitePaths", () => {
  it("covers the site and the blog once each", () => {
    const paths = sitePaths();
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain("/");
    expect(paths).toContain("/blog/stores-sell-courses-and-downloads");
  });
});
