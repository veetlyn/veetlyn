import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { type StoreUrlParts, storeUrlParts } from "./store-url";

// The api Worker resolves stores from the original host, so the request keeps it.
export async function callApi(path: string, init?: RequestInit): Promise<Response> {
  const host = (await headers()).get("host") ?? "localhost";
  return env.SERVER.fetch(new Request(`http://${host}${path}`, init));
}

export async function getStoreUrlParts(): Promise<StoreUrlParts> {
  const host = (await headers()).get("host") ?? "";
  return storeUrlParts(env.STORE_DOMAIN, host);
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

export async function requireSession(): Promise<z.infer<typeof sessionSchema>> {
  const cookie = (await headers()).get("cookie") ?? "";
  const response = await callApi("/api/auth/get-session", { headers: { cookie } });
  const parsed = sessionSchema.safeParse(response.ok ? await response.json() : null);
  if (!parsed.success) redirect("/login");
  return parsed.data;
}
