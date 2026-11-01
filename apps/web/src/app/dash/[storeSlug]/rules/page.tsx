import { redirect } from "next/navigation";

// The operating model moved under Settings; links already sent keep working.
export default async function RulesMoved({ params }: { params: Promise<{ storeSlug: string }> }) {
  const { storeSlug } = await params;
  redirect(`/${storeSlug}/settings/operating-model`);
}
