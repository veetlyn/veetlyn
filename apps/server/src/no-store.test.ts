import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { noStoreByDefault } from "./no-store";

const app = new Hono();
app.use(noStoreByDefault);
app.get("/trpc/team.get", (c) => c.json({ team: "private" }));
app.get("/images/a.png", (c) => c.body("png", 200, { "cache-control": "public, max-age=31536000, immutable" }));

describe("noStoreByDefault", () => {
  it("marks answers without their own caching rule as private and not stored", async () => {
    const res = await app.request("/trpc/team.get");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("keeps the caching rule a shareable route sets", async () => {
    const res = await app.request("/images/a.png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });
});
