"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { type FormEvent, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { RESET_PASSWORD_PATH, TOO_MANY_ATTEMPTS } from "@/lib/auth-flow";

import TextField from "./text-field";

export default function ForgotPasswordForm() {
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setPending(true);
    setError(null);
    const { error: requestError } = await authClient.requestPasswordReset({ email, redirectTo: RESET_PASSWORD_PATH });
    setPending(false);
    // Every other outcome shows the same confirmation, so the page never reveals whether an account exists.
    if (requestError?.status === 429) {
      setError(TOO_MANY_ATTEMPTS);
      return;
    }
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <p role="status" className="text-sm">
        If an account exists for <strong className="font-medium">{sentTo}</strong>, we sent a link to reset your
        password. The link expires in 1 hour.
      </p>
    );
  }

  return (
    // method="post" keeps the email out of the URL if the form is submitted before hydration.
    <form method="post" onSubmit={handleSubmit} className="space-y-4">
      <TextField id="email" name="email" label="Email" type="email" autoComplete="email" required />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
