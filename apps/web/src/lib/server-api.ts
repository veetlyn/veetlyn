import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { type PlatformOrigins, platformOrigins } from "./platform-url";
import { type StoreUrlParts, storeUrlParts } from "./store-url";

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

const storeInfoSchema = z.object({ storeId: z.string(), slug: z.string(), name: z.string() });
export type StoreInfo = z.infer<typeof storeInfoSchema>;

export async function fetchStoreInfo(): Promise<StoreInfo | null> {
  const response = await callApi("/api/store");
  if (!response.ok) return null;
  const parsed = storeInfoSchema.safeParse(await response.json());
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
