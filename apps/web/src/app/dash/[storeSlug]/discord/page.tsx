import { redirect } from "next/navigation";

// Chat channels moved under Settings; links already sent keep working.
export default async function DiscordMoved({ params }: { params: Promise<{ storeSlug: string }> }) {
  const { storeSlug } = await params;
  redirect(`/${storeSlug}/settings/channels`);
}
