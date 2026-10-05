"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-flow";

import InvalidResetLink from "./invalid-reset-link";
import TextField from "./text-field";

export default function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const newPassword = String(data.get("password") ?? "");
    if (newPassword !== String(data.get("confirm") ?? "")) {
      setError("The passwords do not match.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await authClient.resetPassword({ newPassword, token });
    if (!result.error) {
      router.replace("/login?reset=1");
      return;
    }
    setPending(false);
    if (result.error.code === "INVALID_TOKEN") {
      setInvalid(true);
      return;
    }
    setError(authErrorMessage(result.error, "Could not change your password. Try again."));
  }

  if (invalid) return <InvalidResetLink />;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <TextField
        id="password"
        name="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        hint="At least 10 characters."
      />
      <TextField id="confirm" name="confirm" label="Repeat the new password" type="password" autoComplete="new-password" required />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}
