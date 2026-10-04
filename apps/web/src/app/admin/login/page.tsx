"use client";

import { useState } from "react";

import PayPalSignInButton from "@/components/paypal-sign-in-button";
import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";

export default function LoginPage() {
  const [showSignIn, setShowSignIn] = useState(false);

  // One child only: the admin layout is a two-row grid (header, page).
  return (
    <main className="overflow-y-auto">
      <div className="mx-auto w-full max-w-md">
        {showSignIn ? (
          <SignInForm onSwitchToSignUp={() => setShowSignIn(false)} />
        ) : (
          <SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} />
        )}
        <div className="px-6 pb-10">
          <div className="mb-4 flex items-center gap-3 text-sm text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          <PayPalSignInButton />
        </div>
      </div>
    </main>
  );
}
