import { requireSession } from "@/lib/server-api";

import PayoutsSetup from "./payouts-setup";

// The freelancer portal's payout destination page (services spec §4.2 and §9); later plans build the
// rest of /me around it.
export default async function PayoutsSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string; error?: string }>;
}) {
  await requireSession();
  const { connect, error } = await searchParams;
  return <PayoutsSetup connect={connect === "1"} paypalError={Boolean(error)} />;
}
