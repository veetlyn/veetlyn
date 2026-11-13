import { redirect } from "next/navigation";

// Threads used to live at /calls. Old links and bookmarks land on /threads; ?call= becomes ?thread=.
export default async function OldTeamCalls({ params, searchParams }: { params: Promise<{ storeSlug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { storeSlug } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key === "call" ? "thread" : key, item);
  }
  const search = query.toString();
  redirect(`/${encodeURIComponent(storeSlug)}/threads${search ? `?${search}` : ""}`);
}
