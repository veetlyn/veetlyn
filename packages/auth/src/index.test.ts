import { defaultServicesTeamSettings } from "@jendal-workspace/core";
import { user } from "@jendal-workspace/db/schema/auth";
import { team } from "@jendal-workspace/db/schema/organization";
import { servicesTeamSettings } from "@jendal-workspace/db/schema/services-teams";
import { createTestDb, hasTestDatabase, truncateAll } from "@jendal-workspace/db/testing/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { cookieHeaders, createTestAuth, signUpVerified, TEST_AUTH_CONFIG, TEST_PASSWORD } from "./testing";

const BASE = TEST_AUTH_CONFIG.BETTER_AUTH_URL;

function linkIn(text: string): URL {
  const match = /https?:\/\/\S+/.exec(text);
  if (!match) throw new Error(`No link in: ${text}`);
  return new URL(match[0]);
}

describe.skipIf(!hasTestDatabase)("stores as Better Auth teams", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function ownerWithOrganization(slug = "acme-inc") {
    const owner = await signUpVerified(auth, db, `owner-${slug}@example.com`);
    const organization = await auth.api.createOrganization({
      body: { name: "Acme Inc", slug },
      headers: owner.headers,
    });
    if (!organization) throw new Error("organization was not created");
    return { ...owner, organizationId: organization.id };
  }

  it("creates a draft store from a normalized slug, with the creator's email as support email", async () => {
    const { headers, organizationId, email } = await ownerWithOrganization();

    const store = await auth.api.createTeam({ body: { name: "Acme", organizationId, slug: " Acme " }, headers });

    const [row] = await db.select().from(team).where(eq(team.id, store.id));
    expect(row).toMatchObject({
      organizationId,
      name: "Acme",
      slug: "acme",
      status: "draft",
      paypalMerchantId: null,
      supportEmail: email,
    });
  });

  it("ignores client attempts to set the status, PayPal merchant or support email", async () => {
    const { headers, organizationId, email } = await ownerWithOrganization();
    const extra: Record<string, unknown> = { status: "active", paypalMerchantId: "FAKE", supportEmail: "x@evil.test" };

    const store = await auth.api.createTeam({
      body: { name: "Acme", organizationId, slug: "acme", ...extra },
      headers,
    });

    const [row] = await db.select().from(team).where(eq(team.id, store.id));
    expect(row).toMatchObject({ status: "draft", paypalMerchantId: null, supportEmail: email });
  });

  it("rejects reserved and malformed slugs", async () => {
    const { headers, organizationId } = await ownerWithOrganization();

    await expect(
      auth.api.createTeam({ body: { name: "Acme", organizationId, slug: "login" }, headers }),
    ).rejects.toMatchObject({ status: "BAD_REQUEST", body: { code: "TEAM_SLUG_RESERVED" } });
    await expect(
      auth.api.createTeam({ body: { name: "Acme", organizationId, slug: "a_b" }, headers }),
    ).rejects.toMatchObject({ status: "BAD_REQUEST", body: { code: "TEAM_SLUG_INVALID" } });
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
    ).rejects.toMatchObject({ status: "CONFLICT", body: { code: "TEAM_SLUG_TAKEN" } });
  });

  it("only lets owners and admins create stores", async () => {
    const { organizationId } = await ownerWithOrganization();
    const staff = await signUpVerified(auth, db, "staff@example.com");
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
    ).rejects.toMatchObject({ status: "BAD_REQUEST", body: { code: "TEAM_SLUG_IMMUTABLE" } });

    const renamed = await auth.api.updateTeam({ body: { teamId: store.id, data: { name: "Acme Goods" } }, headers });
    expect(renamed).toMatchObject({ name: "Acme Goods", slug: "acme" });
  });

  it("gives a team the store product when none is passed, and a services team its settings", async () => {
    const { headers, organizationId, email } = await ownerWithOrganization();

    const store = await auth.api.createTeam({ body: { name: "Acme", organizationId, slug: "acme" }, headers });
    const studio = await auth.api.createTeam({
      body: { name: "Acme Studio", organizationId, slug: "acme-studio", product: "services" },
      headers,
    });

    const teams = await db.select().from(team).where(eq(team.organizationId, organizationId));
    expect(teams.find((t) => t.id === store.id)).toMatchObject({ product: "store", supportEmail: email });
    expect(teams.find((t) => t.id === studio.id)).toMatchObject({ product: "services", supportEmail: null });
    await expect(
      db.select().from(servicesTeamSettings).where(eq(servicesTeamSettings.teamId, studio.id)),
    ).resolves.toEqual([defaultServicesTeamSettings(studio.id)]);
  });

  it("rejects an unknown product with the same codes the slug rules use", async () => {
    const { headers, organizationId } = await ownerWithOrganization();

    await expect(
      auth.api.createTeam({ body: { name: "Acme", organizationId, slug: "acme", product: "shop" as never }, headers }),
    ).rejects.toMatchObject({ status: "BAD_REQUEST", body: { code: "TEAM_PRODUCT_INVALID" } });
  });

  it("words slug errors for a services team", async () => {
    const { headers, organizationId } = await ownerWithOrganization();

    await expect(
      auth.api.createTeam({ body: { name: "Acme", organizationId, slug: "login", product: "services" }, headers }),
    ).rejects.toMatchObject({ status: "BAD_REQUEST", body: { code: "TEAM_SLUG_RESERVED", message: "This team address is reserved." } });
  });

  it("rejects a slug that a services team already uses, for a store", async () => {
    const { headers, organizationId } = await ownerWithOrganization();
    await auth.api.createTeam({ body: { name: "Acme Studio", organizationId, slug: "acme-studio", product: "services" }, headers });

    await expect(
      auth.api.createTeam({ body: { name: "Acme", organizationId, slug: "acme-studio" }, headers }),
    ).rejects.toMatchObject({ status: "CONFLICT", body: { code: "TEAM_SLUG_TAKEN" } });
  });

  it("refuses to change a team's product, and still allows renaming", async () => {
    const { headers, organizationId } = await ownerWithOrganization();
    const store = await auth.api.createTeam({ body: { name: "Acme", organizationId, slug: "acme" }, headers });

    await expect(
      auth.api.updateTeam({ body: { teamId: store.id, data: { product: "services" } }, headers }),
    ).rejects.toMatchObject({ status: "BAD_REQUEST", body: { code: "TEAM_PRODUCT_IMMUTABLE" } });

    const renamed = await auth.api.updateTeam({ body: { teamId: store.id, data: { name: "Acme Goods" } }, headers });
    expect(renamed).toMatchObject({ name: "Acme Goods", product: "store" });
  });

  it("does not create a default team with a new organization", async () => {
    const { organizationId } = await ownerWithOrganization();

    await expect(db.select().from(team).where(eq(team.organizationId, organizationId))).resolves.toEqual([]);
  });
});

describe.skipIf(!hasTestDatabase)("email verification", () => {
  const db = createTestDb();
  const { auth, mailer, settle } = createTestAuth(db);

  beforeEach(async () => {
    await truncateAll(db);
    mailer.sent.length = 0;
  });
  afterAll(() => db.$client.end());

  async function signUp(email = "ada@example.com") {
    return auth.api.signUpEmail({
      body: { name: "Ada", email, password: TEST_PASSWORD, callbackURL: "/new" },
    });
  }

  it("sends one verification email on sign-up, linking back to /new, and starts no session", async () => {
    const result = await signUp();
    await settle();

    expect(result.token).toBeNull();
    expect(mailer.sent).toHaveLength(1);
    const [message] = mailer.sent;
    expect(message).toMatchObject({ to: "ada@example.com", subject: "Verify your email for Payleor" });
    const link = linkIn(message?.text ?? "");
    expect(link.origin + link.pathname).toBe(`${BASE}/api/auth/verify-email`);
    expect(link.searchParams.get("callbackURL")).toBe("/new");
  });

  it("rejects passwords shorter than 10 characters", async () => {
    await expect(
      auth.api.signUpEmail({ body: { name: "Ada", email: "ada@example.com", password: "short-pw1" } }),
    ).rejects.toMatchObject({ status: "BAD_REQUEST" });
  });

  it("refuses email sign-in before verification and sends a fresh link", async () => {
    await signUp();

    await expect(
      auth.api.signInEmail({ body: { email: "ada@example.com", password: TEST_PASSWORD, callbackURL: "/new" } }),
    ).rejects.toMatchObject({ status: "FORBIDDEN", body: { code: "EMAIL_NOT_VERIFIED" } });
    await settle();
    expect(mailer.sent).toHaveLength(2);
  });

  it("verifies the address and signs the user in from the emailed link", async () => {
    await signUp();
    await settle();
    const link = linkIn(mailer.sent[0]?.text ?? "");

    const response = await auth.handler(new Request(link));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toMatch(/\/new$/);
    const session = await auth.api.getSession({ headers: cookieHeaders(response.headers) });
    expect(session?.user).toMatchObject({ email: "ada@example.com", emailVerified: true });
  });

  it("records when each new user accepted the terms", async () => {
    const before = new Date();
    const { user: created } = await signUp();

    const [row] = await db.select().from(user).where(eq(user.id, created.id));
    expect(row?.acceptedTermsAt).toBeInstanceOf(Date);
    expect(row?.acceptedTermsAt?.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });
});

describe.skipIf(!hasTestDatabase)("password reset", () => {
  const db = createTestDb();
  const { auth, mailer, settle } = createTestAuth(db);

  beforeEach(async () => {
    await truncateAll(db);
    mailer.sent.length = 0;
  });
  afterAll(() => db.$client.end());

  async function resetToken(email: string): Promise<string> {
    await auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } });
    await settle();
    const message = mailer.sent.find((m) => m.subject === "Reset your Payleor password");
    const response = await auth.handler(new Request(linkIn(message?.text ?? "")));
    const location = new URL(response.headers.get("location") ?? "", BASE);
    expect(location.pathname).toBe("/reset-password");
    const token = location.searchParams.get("token");
    if (!token) throw new Error("no token in the reset redirect");
    return token;
  }

  it("emails a link that leads to the reset page with a token", async () => {
    await signUpVerified(auth, db, "ada@example.com");

    await expect(resetToken("ada@example.com")).resolves.toEqual(expect.any(String));
  });

  it("changes the password and signs out every session", async () => {
    const { headers } = await signUpVerified(auth, db, "ada@example.com");
    const token = await resetToken("ada@example.com");

    await auth.api.resetPassword({ body: { newPassword: "a-brand-new-password", token } });

    await expect(auth.api.getSession({ headers })).resolves.toBeNull();
    await expect(
      auth.api.signInEmail({ body: { email: "ada@example.com", password: TEST_PASSWORD } }),
    ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
    await expect(
      auth.api.signInEmail({ body: { email: "ada@example.com", password: "a-brand-new-password" } }),
    ).resolves.toMatchObject({ user: { email: "ada@example.com" } });
  });

  it("rejects an unknown token", async () => {
    await expect(
      auth.api.resetPassword({ body: { newPassword: "a-brand-new-password", token: "nope" } }),
    ).rejects.toMatchObject({ status: "BAD_REQUEST", body: { code: "INVALID_TOKEN" } });
  });
});

describe.skipIf(!hasTestDatabase)("rate limits", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  function post(path: string, ip: string, body: unknown): Request {
    return new Request(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, "cf-connecting-ip": ip },
      body: JSON.stringify(body),
    });
  }

  async function statuses(count: number, request: () => Request): Promise<number[]> {
    const result: number[] = [];
    for (let i = 0; i < count; i++) result.push((await auth.handler(request())).status);
    return result;
  }

  it("allows 5 email sign-in attempts per minute from one IP", async () => {
    const attempt = () => post("/sign-in/email", "203.0.113.7", { email: "nobody@example.com", password: "wrong-password-1" });

    const result = await statuses(6, attempt);

    expect(result.slice(0, 5)).not.toContain(429);
    expect(result[5]).toBe(429);
  });

  it("counts each IP separately", async () => {
    await statuses(6, () => post("/sign-in/email", "203.0.113.7", { email: "a@example.com", password: "wrong-password-1" }));

    const other = await auth.handler(
      post("/sign-in/email", "203.0.113.8", { email: "a@example.com", password: "wrong-password-1" }),
    );
    expect(other.status).not.toBe(429);
  });

  it("allows 3 password reset requests per 10 minutes", async () => {
    const request = () => post("/request-password-reset", "203.0.113.9", { email: "a@example.com", redirectTo: "/reset-password" });

    const result = await statuses(4, request);

    expect(result.slice(0, 3)).not.toContain(429);
    expect(result[3]).toBe(429);
  });
});

describe.skipIf(!hasTestDatabase)("email failures", () => {
  const db = createTestDb();
  const failing = { send: () => Promise.reject(new Error("SMTP down")) };
  const { auth, emailErrors, settle } = createTestAuth(db, { mailer: failing });

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("completes sign-up and reports the failed send", async () => {
    await expect(
      auth.api.signUpEmail({ body: { name: "Ada", email: "ada@example.com", password: TEST_PASSWORD } }),
    ).resolves.toMatchObject({ user: { email: "ada@example.com" } });
    await settle();

    expect(emailErrors).toEqual([{ kind: "verification", to: "ada@example.com" }]);
  });
});

describe.skipIf(!hasTestDatabase)("Log in with PayPal", () => {
  const db = createTestDb();
  afterAll(() => db.$client.end());

  async function authorizeUrl(environment: string) {
    const { auth } = createTestAuth(db, { config: { PAYPAL_ENVIRONMENT: environment } });
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

describe.skipIf(!hasTestDatabase)("Discord sign-in and linking", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("starts Discord sign-in at Discord's authorize page with the identify and email scopes", async () => {
    const { url } = await auth.api.signInSocial({ body: { provider: "discord", disableRedirect: true } });

    const parsed = new URL(url ?? "");
    expect(parsed.origin + parsed.pathname).toBe("https://discord.com/api/oauth2/authorize");
    expect(parsed.searchParams.get("scope")).toBe("identify email");
    expect(parsed.searchParams.get("redirect_uri")).toBe(`${BASE}/api/auth/callback/discord`);
    expect(parsed.searchParams.get("client_id")).toBe("discord-client-id");
  });

  it("starts linking for a signed-in user", async () => {
    const { headers } = await signUpVerified(auth, db, "ada@example.com");

    const result = await auth.api.linkSocialAccount({
      body: {
        provider: "discord",
        callbackURL: "/account",
        errorCallbackURL: "/account?error=discord",
        disableRedirect: true,
      },
      headers,
    });

    const parsed = new URL(result.url ?? "");
    expect(parsed.origin + parsed.pathname).toBe("https://discord.com/api/oauth2/authorize");
    expect(parsed.searchParams.get("redirect_uri")).toBe(`${BASE}/api/auth/callback/discord`);
  });

  it("requires a session to link Discord", async () => {
    // linkSocial requires headers (Fact 11); empty ones reach the session check.
    await expect(
      auth.api.linkSocialAccount({ body: { provider: "discord", disableRedirect: true }, headers: new Headers() }),
    ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
  });

  it("lets a signed-in user link a different email but trusts no provider for implicit linking", async () => {
    const context = await auth.$context;

    expect(context.options.account?.accountLinking?.allowDifferentEmails).toBe(true);
    // A trusted provider would link a Discord or PayPal sign-in to any Payleor user with the same,
    // possibly unverified, provider email (Fact 22).
    expect(context.trustedProviders).toEqual([]);
  });
});
