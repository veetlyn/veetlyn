import { createTestAuth } from "@jendal-workspace/auth/testing";
import { createFakeFileStore } from "@jendal-workspace/core";
import { user } from "@jendal-workspace/db/schema/auth";
import { createTestDb, hasTestDatabase, truncateAll } from "@jendal-workspace/db/testing/db";
import { fromPartial } from "@total-typescript/shoehorn";
import { eq } from "drizzle-orm";
import type { RequestLogger } from "evlog";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createMcpRoute } from "./route";

// The scripted OAuth client: what Claude and ChatGPT do when they connect, against the real Better Auth setup.
// The issuer is the test auth URL; the token check fetches the issuer's keys, which this routes to it.
const ISSUER = "http://dash.localhost:3001/api/auth";
const RESOURCE = "https://api.localhost/mcp";
const REDIRECT = "https://client.example/callback";

describe.skipIf(!hasTestDatabase)("connecting an AI client with OAuth", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);
  const route = createMcpRoute(
    {
      actions: { db, files: createFakeFileStore(), auth },
      auth,
      log: fromPartial<RequestLogger>({ set: () => {} }),
      storeOrigin: (slug) => `https://${slug}.payleor.test`,
    },
    { authUrl: "http://dash.localhost:3001", origins: { api: "https://api.localhost", storeWildcard: "https://*.payleor.test" } },
  );

  beforeEach(async () => {
    await truncateAll(db);
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      return request.url.startsWith(ISSUER) ? auth.handler(request) : realFetch(request);
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(() => db.$client.end());

  const authRequest = (path: string, init?: RequestInit) => auth.handler(new Request(`${ISSUER}${path}`, init));

  function mcpList(token?: string) {
    const headers = new Headers({
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25",
    });
    if (token) headers.set("authorization", `Bearer ${token}`);
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    return route(new Request(RESOURCE, { method: "POST", headers, body }));
  }

  async function pkce() {
    const verifier = crypto.randomUUID() + crypto.randomUUID();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return { verifier, challenge };
  }

  async function signedInCookie(): Promise<string> {
    await auth.api.signUpEmail({ body: { email: "ann@example.com", password: "a-long-test-password", name: "Ann" } });
    await db.update(user).set({ emailVerified: true }).where(eq(user.email, "ann@example.com"));
    const signIn = await auth.api.signInEmail({
      body: { email: "ann@example.com", password: "a-long-test-password" },
      returnHeaders: true,
    });
    const cookie = signIn.headers.get("set-cookie");
    if (!cookie) throw new Error("sign-in set no cookie");
    return cookie.split(";")[0] ?? "";
  }

  it("answers an unauthenticated call with a challenge that points at the resource metadata", async () => {
    const response = await mcpList();
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
    // The api Worker answers the metadata from Better Auth, naming the dashboard's issuer.
    const metadata = await auth.handler(new Request("https://api.localhost/.well-known/oauth-protected-resource/mcp"));
    expect(await metadata.json()).toMatchObject({ resource: RESOURCE, authorization_servers: [ISSUER] });
  });

  it("registers a client, signs in, consents, gets a token and lists the tools", async () => {
    const registered = await authRequest("/oauth2/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Harness",
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
    expect(registered.status).toBeLessThan(300);
    const { client_id: clientId } = z.object({ client_id: z.string() }).parse(await registered.json());

    const cookie = await signedInCookie();
    const { verifier, challenge } = await pkce();
    const query = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT,
      scope: "openid profile email offline_access",
      state: "state-1",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: RESOURCE,
    });
    const authorize = await authRequest(`/oauth2/authorize?${query}`, { headers: { cookie } });
    const toConsent = new URL(authorize.headers.get("location") ?? "", ISSUER);
    expect(toConsent.pathname).toBe("/oauth/consent");

    const consent = await authRequest("/oauth2/consent", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ accept: true, oauth_query: toConsent.search.slice(1) }),
    });
    const consented = z.object({ url: z.string() }).parse(await consent.json());
    const code = new URL(consented.url).searchParams.get("code");
    expect(code).toBeTruthy();

    const tokenResponse = await authRequest("/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code ?? "",
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
        resource: RESOURCE,
      }),
    });
    const { access_token: accessToken } = z.object({ access_token: z.string() }).parse(await tokenResponse.json());

    const listed = await mcpList(accessToken);
    expect(listed.status).toBe(200);
    expect(await listed.text()).toContain("search_offerings");
    // A token whose signature does not verify is refused.
    const tampered = `${accessToken.slice(0, -4)}AAAA`;
    expect((await mcpList(tampered)).status).toBe(401);
  });
});
