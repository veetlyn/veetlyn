"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { authErrorMessage, isEmailNotVerified, verifyEmailPath } from "@/lib/auth-flow";

import TermsNotice from "./terms-notice";
import TextField from "./text-field";

export default function SignInForm({ siteOrigin }: { siteOrigin: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    setPending(true);
    setError(null);
    // No callbackURL: the client would redirect to it on success (Fact 14).
    const result = await authClient.signIn.email({ email, password: String(data.get("password") ?? "") });
    if (!result.error) {
      router.replace("/");
      return;
    }
    setPending(false);
    if (isEmailNotVerified(result.error)) {
      router.push(verifyEmailPath(email));
      return;
    }
    setError(authErrorMessage(result.error, "Could not log you in. Check your email and password."));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <TextField id="email" name="email" label="Email" type="email" autoComplete="email" required />
      <TextField id="password" name="password" label="Password" type="password" autoComplete="current-password" required />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <TermsNotice siteOrigin={siteOrigin} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Logging in…" : "Log in"}
      </Button>
    </form>
  );
}
