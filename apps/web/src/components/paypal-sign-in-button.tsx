"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

export default function PayPalSignInButton() {
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    // On success the client follows the redirect to PayPal, so the button stays disabled.
    const { error } = await authClient.signIn.social({ provider: "paypal", callbackURL: "/" });
    if (error) {
      setPending(false);
      toast.error(error.message ?? "Could not start PayPal sign-in.");
    }
  }

  return (
    <Button type="button" variant="outline" className="w-full" onClick={signIn} disabled={pending}>
      {pending ? "Redirecting to PayPal..." : "Continue with PayPal"}
    </Button>
  );
}
