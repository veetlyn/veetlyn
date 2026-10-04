import { team } from "@jendal-workspace/db/schema/organization";
import { createTestDb, hasTestDatabase, truncateAll } from "@jendal-workspace/db/testing/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createAuth } from "./index";

const config = {
  BETTER_AUTH_URL: "http://admin.localhost:3001",
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
  PAYPAL_CLIENT_ID: "sandbox-client-id",
  PAYPAL_CLIENT_SECRET: "sandbox-client-secret",
  PAYPAL_ENVIRONMENT: "sandbox",
};

describe.skipIf(!hasTestDatabase)("stores as Better Auth teams", () => {
  const db = createTestDb();
  const auth = createAuth(config, db);

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function signUp(email: string) {
    const { headers, response } = await auth.api.signUpEmail({
      body: { name: "Ada", email, password: "correct-horse-battery" },
      returnHeaders: true,
    });
    const cookie = headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    return { userId: response.user.id, headers: new Headers({ cookie }) };
  }

  async function ownerWithOrganization(slug = "acme-inc") {
    const owner = await signUp(`owner-${slug}@example.com`);
    const organization = await auth.api.createOrganization({
      body: { name: "Acme Inc", slug },
      headers: owner.headers,
    });
    if (!organization) throw new Error("organization was not created");
    return { ...owner, organizationId: organization.id };
  }

  it("creates a draft store from a normalized slug", async () => {
    const { headers, organizationId } = await ownerWithOrganization();

    const store = await auth.api.createTeam({ body: { name: "Acme", organizationId, slug: " Acme " }, headers });

    const [row] = await db.select().from(team).where(eq(team.id, store.id));
    expect(row).toMatchObject({ organizationId, name: "Acme", slug: "acme", status: "draft", paypalMerchantId: null });
  });

  it("ignores client attempts to set the status or PayPal merchant", async () => {
    const { headers, organizationId } = await ownerWithOrganization();
    const extra: Record<string, unknown> = { status: "active", paypalMerchantId: "FAKE" };

    const store = await auth.api.createTeam({
      body: { name: "Acme", organizationId, slug: "acme", ...extra },
      headers,
    });

    const [row] = await db.select().from(team).where(eq(team.id, store.id));
    expect(row).toMatchObject({ status: "draft", paypalMerchantId: null });
  });

  it("rejects reserved and malformed slugs", async () => {
    const { headers, organizationId } = await ownerWithOrganization();

    await expect(
      auth.api.createTeam({ body: { name: "Acme", organizationId, slug: "login" }, headers }),
    ).rejects.toMatchObject({ status: "BAD_REQUEST", body: { code: "STORE_SLUG_RESERVED" } });
    await expect(
      auth.api.createTeam({ body: { name: "Acme", organizationId, slug: "a_b" }, headers }),
    ).rejects.toMatchObject({ status: "BAD_REQUEST", body: { code: "STORE_SLUG_INVALID" } });
  });

  it("rejects a slug that another store already uses", async () => {
    const first = await ownerWithOrganization("first-org");
    const second = await ownerWithOrganization("second-org");
    await auth.api.createTeam({
      body: { name: "Acme", organizationId: first.organizationId, slug: "acme" },
      headers: first.headers,
    });

    await expect(
      auth.api.createTeam({
        body: { name: "Other", organizationId: second.organizationId, slug: "acme" },
        headers: second.headers,
      }),
    ).rejects.toMatchObject({ status: "CONFLICT", body: { code: "STORE_SLUG_TAKEN" } });
  });

  it("only lets owners and admins create stores", async () => {
    const { organizationId } = await ownerWithOrganization();
    const staff = await signUp("staff@example.com");
    await auth.api.addMember({ body: { userId: staff.userId, organizationId, role: "member" } });

    await expect(
      auth.api.createTeam({ body: { name: "Acme", organizationId, slug: "acme" }, headers: staff.headers }),
    ).rejects.toMatchObject({ status: "FORBIDDEN" });
  });

  it("keeps the slug fixed and allows renaming", async () => {
    const { headers, organizationId } = await ownerWithOrganization();
    const store = await auth.api.createTeam({ body: { name: "Acme", organizationId, slug: "acme" }, headers });

    await expect(
      auth.api.updateTeam({ body: { teamId: store.id, data: { slug: "other" } }, headers }),
    ).rejects.toMatchObject({ status: "BAD_REQUEST", body: { code: "STORE_SLUG_IMMUTABLE" } });

    const renamed = await auth.api.updateTeam({ body: { teamId: store.id, data: { name: "Acme Goods" } }, headers });
    expect(renamed).toMatchObject({ name: "Acme Goods", slug: "acme" });
  });

  it("does not create a default team with a new organization", async () => {
    const { organizationId } = await ownerWithOrganization();

    await expect(db.select().from(team).where(eq(team.organizationId, organizationId))).resolves.toEqual([]);
  });
});

describe.skipIf(!hasTestDatabase)("Log in with PayPal", () => {
  const db = createTestDb();
  afterAll(() => db.$client.end());

  async function authorizeUrl(environment: string) {
    const auth = createAuth({ ...config, PAYPAL_ENVIRONMENT: environment }, db);
    const { url } = await auth.api.signInSocial({ body: { provider: "paypal", disableRedirect: true } });
    if (!url) throw new Error("no authorize URL");
    return new URL(url);
  }

  it("asks PayPal for the OpenID scopes, which its authorize page requires", async () => {
    const url = await authorizeUrl("sandbox");

    expect(url.origin + url.pathname).toBe("https://www.sandbox.paypal.com/signin/authorize");
    expect(url.searchParams.get("scope")).toBe(
      "openid profile email https://uri.paypal.com/services/paypalattributes",
    );
    expect(url.searchParams.get("redirect_uri")).toBe("http://admin.localhost:3001/api/auth/callback/paypal");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("uses the live authorize page in the live environment", async () => {
    const url = await authorizeUrl("live");

    expect(url.origin + url.pathname).toBe("https://www.paypal.com/signin/authorize");
    expect(url.searchParams.get("scope")).toContain("openid");
  });
});
