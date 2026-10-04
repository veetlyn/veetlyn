import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { BASE_PATH_HEADER } from "./host-routing";

// The api Worker resolves stores from the original host and path, so the request keeps both.
export async function callApi(path: string, init?: RequestInit): Promise<Response> {
  const incoming = await headers();
  const host = incoming.get("host") ?? "localhost";
  const basePath = incoming.get(BASE_PATH_HEADER) ?? "";
  return env.SERVER.fetch(new Request(`http://${host}${basePath}${path}`, init));
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
