import { requireSession } from "@/lib/server-api";

import AccountSettings from "./account-settings";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireSession();
  const { error } = await searchParams;
  return <AccountSettings hasError={Boolean(error)} />;
}
