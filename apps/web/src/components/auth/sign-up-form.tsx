"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { authErrorMessage, VERIFIED_EMAIL_REDIRECT, verifyEmailPath } from "@/lib/auth-flow";

import TermsNotice from "./terms-notice";
import TextField from "./text-field";

export default function SignUpForm({ siteOrigin }: { siteOrigin: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    setPending(true);
    setError(null);
    const result = await authClient.signUp.email({
      name: String(data.get("name") ?? "").trim(),
      email,
      password: String(data.get("password") ?? ""),
      callbackURL: VERIFIED_EMAIL_REDIRECT,
    });
    if (!result.error) {
      router.push(verifyEmailPath(email));
      return;
    }
    setPending(false);
    setError(authErrorMessage(result.error, "Could not create your account. Try again."));
  }

  return (
    // method="post": a submit before hydration would otherwise be a native GET that puts the password in the URL.
    <form method="post" onSubmit={handleSubmit} className="space-y-4">
      <TextField id="name" name="name" label="Your name" autoComplete="name" required minLength={2} />
      <TextField id="email" name="email" label="Email" type="email" autoComplete="email" required />
      <TextField
        id="password"
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        hint="At least 10 characters."
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <TermsNotice siteOrigin={siteOrigin} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating your account…" : "Create account"}
      </Button>
    </form>
  );
}
