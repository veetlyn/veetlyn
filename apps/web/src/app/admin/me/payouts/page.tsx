import { requireSession } from "@/lib/server-api";

import PayoutsSetup from "./payouts-setup";

// The freelancer portal's payouts page (services spec §4.2 and §9): the payout destination, earnings per team
// and payout requests.
export default async function PayoutsSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string; adult?: string; error?: string }>;
}) {
  await requireSession();
  const { connect, adult, error } = await searchParams;
  return <PayoutsSetup connect={connect === "1"} confirmAdult={adult === "1"} paypalError={Boolean(error)} />;
}
