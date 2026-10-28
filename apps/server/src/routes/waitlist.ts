import { hitRequestLimit } from "@jendal-workspace/db/repositories/request-limits";
import { launchWaitlist } from "@jendal-workspace/db/schema/waitlist";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

import type { AppEnv } from "../app-env";

const input = z.object({
  email: z.string().trim().toLowerCase().max(254).email(),
  consent: z.literal(true),
  website: z.string().max(200).optional(),
});

export function createWaitlistRoute(platformDomain: string) {
  return new Hono<AppEnv>().post("/api/waitlist", bodyLimit({ maxSize: 1024 }), async (c) => {
    const origin = c.req.header("Origin");
    const allowed = [`https://${platformDomain}`, `https://www.${platformDomain}`];
    if (!origin || !allowed.includes(origin) || c.req.header("Sec-Fetch-Site") === "cross-site") {
      return c.json({ error: "forbidden" }, 403);
    }
    if (!c.req.header("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return c.json({ error: "invalid_content_type" }, 415);
    }
    // Cloudflare supplies this header; use a shared bucket when absent, never a caller-chosen IP.
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`waitlist:${ip}`));
    const key = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    if (!(await hitRequestLimit(c.get("db"), { key: `waitlist:${key}`, max: 10, windowMs: 3_600_000 }))) {
      c.header("Retry-After", "3600");
      return c.json({ error: "too_many_requests" }, 429);
    }
    const parsed = input.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_email_or_consent" }, 400);
    if (!parsed.data.website) {
      await c.get("db").insert(launchWaitlist).values({ email: parsed.data.email }).onConflictDoNothing();
    }
    // Identical response for new, duplicate and honeypot submissions; never disclose membership.
    return c.json({ ok: true });
  });
}
