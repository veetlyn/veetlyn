import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { productionAuthGate } from "./launch-gate";

describe("launch auth gate", () => {
  it.each(["/api/auth/sign-up/email", "/api/auth/sign-in/email", "/api/auth/callback/discord", "/api/auth/get-session", "/api/auth/oauth2/token"])("blocks %s before auth while waiting for launch", async (path) => {
    const app = new Hono();
    app.use("/api/auth/*", productionAuthGate("waitlist"));
    app.all("/api/auth/*", (c) => c.json({ authReached: true }));
    const response = await app.request(`https://api.platform.test${path}`, { method: "POST" });
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ error: "launch_pending" });
  });

  it("allows auth when the launch flag is open", async () => {
    const app = new Hono();
    app.use("/api/auth/*", productionAuthGate("open"));
    app.post("/api/auth/sign-in/email", (c) => c.json({ authReached: true }));
    expect(await (await app.request("/api/auth/sign-in/email", { method: "POST" })).json()).toEqual({ authReached: true });
  });
});
