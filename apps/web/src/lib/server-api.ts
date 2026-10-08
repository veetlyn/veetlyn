import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { type PlatformOrigins, platformOrigins } from "./platform-url";
import { type StoreUrlParts, storeUrlParts } from "./store-url";
import { mergeWorkspaces, type WorkspaceOrganization } from "./workspaces";

async function requestHost(): Promise<string> {
  return (await headers()).get("host") ?? "";
}

// The api Worker resolves stores from the original host, so the request keeps it.
export async function callApi(path: string, init?: RequestInit): Promise<Response> {
  const host = (await requestHost()) || "localhost";
  return env.SERVER.fetch(new Request(`http://${host}${path}`, init));
}

async function callApiAsUser(path: string): Promise<Response> {
  const cookie = (await headers()).get("cookie") ?? "";
  return callApi(path, { headers: { cookie } });
}

export async function getStoreUrlParts(): Promise<StoreUrlParts> {
  return storeUrlParts(env.STORE_DOMAIN, await requestHost());
}

export async function getPlatformOrigins(): Promise<PlatformOrigins> {
  return platformOrigins(env.PLATFORM_DOMAIN, await requestHost());
}

const productSchema = z.enum(["store", "services"]);

const storeInfoSchema = z.object({
  storeId: z.string(),
  slug: z.string(),
  name: z.string(),
  product: productSchema,
});
export type StoreInfo = z.infer<typeof storeInfoSchema>;

export async function fetchStoreInfo(): Promise<StoreInfo | null> {
  const response = await callApi("/api/store");
  if (!response.ok) return null;
  const parsed = storeInfoSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

const offeringSchema = z.object({
  id: z.string(),
  departmentId: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  priceMinMinor: z.number(),
  priceMaxMinor: z.number(),
  daysMin: z.number(),
  daysMax: z.number(),
  intakeQuestions: z.array(z.string()),
  active: z.boolean(),
  position: z.number(),
});
const sellerPageSchema = z.object({
  name: z.string(),
  slug: z.string(),
  product: productSchema,
  status: z.enum(["draft", "active", "suspended"]),
  bio: z.string(),
  supportEmail: z.string().nullable(),
  currency: z.string(),
  departments: z.array(z.object({ id: z.string(), name: z.string(), position: z.number() })),
  offerings: z.array(offeringSchema),
});
export type SellerPageView = z.infer<typeof sellerPageSchema>;

export async function fetchSellerPage(): Promise<SellerPageView | null> {
  const response = await callApi("/api/store/page");
  if (!response.ok) return null;
  const parsed = sellerPageSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

const sessionSchema = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
});
export type SessionInfo = z.infer<typeof sessionSchema>;

async function fetchSession(): Promise<SessionInfo | null> {
  const response = await callApiAsUser("/api/auth/get-session");
  const parsed = sessionSchema.safeParse(response.ok ? await response.json() : null);
  return parsed.success ? parsed.data : null;
}

export async function requireSession(): Promise<SessionInfo> {
  const session = await fetchSession();
  if (!session) redirect("/login");
  return session;
}

export async function redirectIfSignedIn(): Promise<void> {
  if (await fetchSession()) redirect("/");
}

const myStoresSchema = z.object({
  result: z.object({
    data: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        role: z.string(),
        canCreateStores: z.boolean(),
        stores: z.array(z.object({ id: z.string(), slug: z.string(), name: z.string(), status: z.string() })),
      }),
    ),
  }),
});
export type MyOrganization = z.infer<typeof myStoresSchema>["result"]["data"][number];

export async function listMyStores(): Promise<MyOrganization[]> {
  const response = await callApiAsUser("/trpc/store.listMine");
  if (!response.ok) throw new Error(`store.listMine answered ${response.status}`);
  return myStoresSchema.parse(await response.json()).result.data;
}

const myServicesTeamsSchema = z.object({
  result: z.object({
    data: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        role: z.string(),
        servicesTeams: z.array(
          z.object({ id: z.string(), slug: z.string(), name: z.string(), role: z.string() }),
        ),
      }),
    ),
  }),
});
export type MyServicesTeamOrganization = z.infer<typeof myServicesTeamsSchema>["result"]["data"][number];

export async function listMyServicesTeams(): Promise<MyServicesTeamOrganization[]> {
  const response = await callApiAsUser("/trpc/servicesTeam.listMine");
  if (!response.ok) throw new Error(`servicesTeam.listMine answered ${response.status}`);
  return myServicesTeamsSchema.parse(await response.json()).result.data;
}

// The workspace home shows stores and services teams together (services spec §9).
export async function listMyWorkspaces(): Promise<WorkspaceOrganization[]> {
  const [stores, servicesTeams] = await Promise.all([listMyStores(), listMyServicesTeams()]);
  return mergeWorkspaces(stores, servicesTeams);
}

// tRPC speaks plain JSON here (no transformer), so the input is the raw JSON of the procedure input.
export async function isServicesTeamSlug(slug: string): Promise<boolean> {
  const input = encodeURIComponent(JSON.stringify({ teamSlug: slug }));
  const response = await callApiAsUser(`/trpc/servicesTeam.get?input=${input}`);
  // Unknown slugs, stores and outsiders all answer with an error; only "this is your services team" is ok.
  return response.ok;
}

const storePolicyInfoSchema = z.object({
  slug: z.string(),
  name: z.string(),
  product: productSchema,
  supportEmail: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type StorePolicyInfo = z.infer<typeof storePolicyInfoSchema>;

export async function fetchStorePolicyInfo(): Promise<StorePolicyInfo | null> {
  const response = await callApi("/api/store/policy-info");
  if (!response.ok) return null;
  const parsed = storePolicyInfoSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}
