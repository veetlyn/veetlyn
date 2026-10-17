import Link from "next/link";
import { z } from "zod";

import AuthCard from "@/components/auth/auth-card";
import VerifyEmailPanel from "@/components/auth/verify-email-panel";

// A repeated query parameter arrives as an array; only a single address is usable.
const verifySearchParamsSchema = z.object({ email: z.string().optional().catch(undefined) });

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { email } = verifySearchParamsSchema.parse(await searchParams);

  return (
    <AuthCard
      title="Check your inbox"
      footer={
        <p>
          <Link href="/login" className="underline underline-offset-4">
            Back to log in
          </Link>
        </p>
      }
    >
      {email ? (
        <VerifyEmailPanel email={email} />
      ) : (
        <p className="text-sm">Log in or sign up to get a verification link.</p>
      )}
    </AuthCard>
  );
}
