import SandboxCheckoutHelp from "@/components/sandbox-checkout-help";

import PayPage from "./pay-page";

export default async function PayRoute({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <>
      <PayPage token={token} />
      <div className="px-4 pb-10">
        <SandboxCheckoutHelp />
      </div>
    </>
  );
}
