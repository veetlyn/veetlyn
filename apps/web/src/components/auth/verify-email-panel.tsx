"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { authErrorMessage, VERIFIED_EMAIL_REDIRECT } from "@/lib/auth-flow";
import { useCooldown } from "@/lib/use-cooldown";

const RESEND_COOLDOWN_SECONDS = 60;

export default function VerifyEmailPanel({ email }: { email: string }) {
  const { remaining, restart } = useCooldown(RESEND_COOLDOWN_SECONDS);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "status" | "alert"; text: string } | null>(null);

  async function resend() {
    setPending(true);
    setMessage(null);
    const { error } = await authClient.sendVerificationEmail({ email, callbackURL: VERIFIED_EMAIL_REDIRECT });
    setPending(false);
    if (error) {
      setMessage({ tone: "alert", text: authErrorMessage(error, "Could not send the email. Try again.") });
      return;
    }
    setMessage({ tone: "status", text: "We sent a new link." });
    restart();
  }

  return (
    <div className="space-y-4 text-sm">
      <p>
        We sent a link to <strong className="font-medium">{email}</strong>. Open it to verify your address. The link
        expires in 1 hour.
      </p>
      <p className="text-muted-foreground">No email? Check your spam folder, or send a new link.</p>
      {message ? (
        <p role={message.tone} className={message.tone === "alert" ? "text-destructive" : undefined}>
          {message.text}
        </p>
      ) : null}
      <Button type="button" variant="outline" className="w-full" onClick={resend} disabled={pending || remaining > 0}>
        {remaining > 0 ? `Send a new link in ${remaining}s` : pending ? "Sending…" : "Send a new link"}
      </Button>
    </div>
  );
}
