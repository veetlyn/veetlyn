import Link from "next/link";

import AuthCard from "@/components/auth/auth-card";
import VerifyEmailPanel from "@/components/auth/verify-email-panel";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;

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
      {typeof email === "string" && email ? (
        <VerifyEmailPanel email={email} />
      ) : (
        <p className="text-sm">Log in or sign up to get a verification link.</p>
      )}
    </AuthCard>
  );
}
