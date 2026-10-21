import { appRouter } from "@jendal-workspace/api/routers/index";
import { makeSession } from "@jendal-workspace/api/testing";
import { createTestCatalogServices } from "@jendal-workspace/api/testing/catalog";
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
const OTHER_REDIRECT = "https://elsewhere.example/callback";

describe.skipIf(!hasTestDatabase)("connecting an AI client with OAuth", () => {
  const db = createTestDb();
  const { auth, mailer, settle } = createTestAuth(db);
  const route = createMcpRoute(
    {
      actions: { db, platformName: "Platform", files: createFakeFileStore(), auth },
      auth,
      log: fromPartial<RequestLogger>({ set: () => {} }),
      platformName: "Platform",
      storeOrigin: (slug) => `https://${slug}.platform.test`,
    },
    { authUrl: "http://dash.localhost:3001", origins: { api: "https://api.localhost", storeWildcard: "https://*.platform.test" } },
  );

  beforeEach(async () => {
    await truncateAll(db);
    mailer.sent.length = 0;
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

  async function register(redirects: string[], applicationType: "web" | "native" = "web"): Promise<string> {
    const registered = await authRequest("/oauth2/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Harness",
        application_type: applicationType,
        redirect_uris: redirects,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
    expect(registered.status).toBeLessThan(300);
    return z.object({ client_id: z.string() }).parse(await registered.json()).client_id;
  }

  // Where the authorize step sends the browser: the consent page, or the client's redirect with a code.
  async function authorize(cookie: string, clientId: string, redirect: string) {
    const { verifier, challenge } = await pkce();
    const query = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirect,
      scope: "openid profile email offline_access",
      state: "state-1",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: RESOURCE,
    });
    const response = await authRequest(`/oauth2/authorize?${query}`, { headers: { cookie } });
    return { location: new URL(response.headers.get("location") ?? "", ISSUER), verifier };
  }

  async function consent(cookie: string, toConsent: URL): Promise<string> {
    const response = await authRequest("/oauth2/consent", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ accept: true, oauth_query: toConsent.search.slice(1) }),
    });
    const code = new URL(z.object({ url: z.string() }).parse(await response.json()).url).searchParams.get("code");
    if (!code) throw new Error("consent returned no code");
    return code;
  }

  function token(body: Record<string, string>) {
    return authRequest("/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...body, resource: RESOURCE }),
    });
  }

  async function connect(cookie: string, clientId: string) {
    const { location, verifier } = await authorize(cookie, clientId, REDIRECT);
    expect(location.pathname).toBe("/oauth/consent");
    const code = await consent(cookie, location);
    const response = await token({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier });
    return z.object({ access_token: z.string(), refresh_token: z.string() }).parse(await response.json());
  }

  it("registers a client, signs in, consents, gets a token and lists the tools", async () => {
    const clientId = await register([REDIRECT]);
    const { access_token: accessToken } = await connect(await signedInCookie(), clientId);

    const listed = await mcpList(accessToken);
    expect(listed.status).toBe(200);
    expect(await listed.text()).toContain("search_offerings");
    // A token whose signature does not verify is refused.
    const tampered = `${accessToken.slice(0, -4)}AAAA`;
    expect((await mcpList(tampered)).status).toBe(401);
  });

  it("asks again before sending a code to another of the client's hosts than the one the user approved", async () => {
    const clientId = await register([REDIRECT, OTHER_REDIRECT]);
    const cookie = await signedInCookie();
    await connect(cookie, clientId);

    const { location } = await authorize(cookie, clientId, OTHER_REDIRECT);

    expect(location.pathname).toBe("/oauth/consent");
    expect(location.searchParams.get("redirect_uri")).toBe(OTHER_REDIRECT);
  });

  it("asks again for an app whose redirects use different custom schemes", async () => {
    const clientId = await register(["com.platform.one:/callback", "com.other.app:/callback"], "native");
    const cookie = await signedInCookie();
    const first = await authorize(cookie, clientId, "com.platform.one:/callback");
    await consent(cookie, first.location);

    const { location } = await authorize(cookie, clientId, "com.other.app:/callback");

    expect(location.pathname).toBe("/oauth/consent");
  });

  it("lists the client on the account page and ends its access when the user disconnects it", async () => {
    const clientId = await register([REDIRECT]);
    const { access_token: accessToken, refresh_token: refreshToken } = await connect(await signedInCookie(), clientId);
    const [ann] = await db.select({ id: user.id }).from(user).where(eq(user.email, "ann@example.com"));
    const account = appRouter.createCaller({
      db,
      session: makeSession(ann!.id),
      environment: "sandbox",
      platformName: "Platform",
      auth,
      headers: new Headers(),
      catalog: createTestCatalogServices(),
      files: createFakeFileStore(),
    }).connectedApps;
    expect(await account.list()).toEqual([expect.objectContaining({ clientId, name: "Harness" })]);

    await account.disconnect({ clientId });

    expect(await account.list()).toEqual([]);
    // The access token already issued stops working too, not only the refresh.
    expect((await mcpList(accessToken)).status).toBe(401);
    const refreshed = await token({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId });
    expect(refreshed.status).toBe(400);
  });

  it("disconnects every AI client when the password is reset", async () => {
    const clientId = await register([REDIRECT]);
    const { access_token: accessToken, refresh_token: refreshToken } = await connect(await signedInCookie(), clientId);

    await auth.api.requestPasswordReset({ body: { email: "ann@example.com", redirectTo: "/reset-password" } });
    await settle();
    const resetToken = /reset-password\/([^?\s]+)/.exec(mailer.sent.at(-1)?.text ?? "")?.[1];
    await auth.api.resetPassword({ body: { newPassword: "another-long-password", token: resetToken ?? "" } });

    const refreshed = await token({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId });
    expect(refreshed.status).toBe(400);
    expect((await mcpList(accessToken)).status).toBe(401);
  });
});
