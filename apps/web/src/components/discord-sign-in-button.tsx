"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

export default function DiscordSignInButton({ label }: { label: string }) {
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    const result = await authClient.signIn.social({ provider: "discord", callbackURL: "/" });
    if (result.error) {
      setPending(false);
      toast.error(result.error.message ?? "Could not start Discord sign-in.");
    }
    // On success the client follows the redirect to Discord, so the button stays disabled.
  }

  return (
    <Button type="button" variant="outline" className="w-full" onClick={signIn} disabled={pending}>
      {pending ? "Redirecting to Discord…" : label}
    </Button>
  );
}
