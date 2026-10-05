import Link from "next/link";

import AuthCard from "@/components/auth/auth-card";
import OrDivider from "@/components/auth/or-divider";
import SignUpForm from "@/components/auth/sign-up-form";
import PayPalSignInButton from "@/components/paypal-sign-in-button";
import { getPlatformOrigins } from "@/lib/server-api";

export default async function SignUpPage() {
  const origins = await getPlatformOrigins();

  return (
    <AuthCard
      title="Create your Payleor account"
      description="Free for 14 days. No setup fee."
      footer={
        <p>
          Already have an account?{" "}
          <Link href="/login" className="underline underline-offset-4">
            Log in
          </Link>
        </p>
      }
    >
      <SignUpForm siteOrigin={origins.site} />
      <OrDivider />
      <PayPalSignInButton label="Sign up with PayPal" />
    </AuthCard>
  );
}
