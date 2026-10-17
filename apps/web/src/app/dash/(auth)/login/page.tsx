import Link from "next/link";

import AuthCard from "@/components/auth/auth-card";
import OrDivider from "@/components/auth/or-divider";
import SignInForm from "@/components/auth/sign-in-form";
import DiscordSignInButton from "@/components/discord-sign-in-button";
import PayPalSignInButton from "@/components/paypal-sign-in-button";
import { getPlatformOrigins } from "@/lib/server-api";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const [{ reset }, origins] = await Promise.all([searchParams, getPlatformOrigins()]);

  return (
    <AuthCard
      title="Log in to Payleor"
      footer={
        <>
          <p>
            <Link href="/forgot-password" className="underline underline-offset-4">
              Forgot your password?
            </Link>
          </p>
          <p>
            New to Payleor?{" "}
            <Link href="/signup" className="underline underline-offset-4">
              Create an account
            </Link>
          </p>
        </>
      }
    >
      {reset === "1" ? (
        <p
          role="status"
          className="border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-50"
        >
          Your password was changed. Log in with your new password.
        </p>
      ) : null}
      <SignInForm siteOrigin={origins.site} />
      <OrDivider />
      <PayPalSignInButton label="Log in with PayPal" />
      <DiscordSignInButton label="Continue with Discord" />
    </AuthCard>
  );
}
