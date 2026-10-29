"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

export default function WaitlistForm() {
  const [state, setState] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "pending") return;
    const form = new FormData(event.currentTarget);
    setError("");
    setState("pending");
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), consent: form.get("consent") === "on", website: form.get("website") }),
      });
      if (response.ok) {
        setState("success");
      } else {
        setError(response.status === 429
          ? "Too many attempts just now. Please try again in an hour."
          : "We couldn’t add you just now. Please try again.");
        setState("error");
      }
    } catch {
      setError("Check your connection and try again.");
      setState("error");
    }
  }
  return (
    <form className="mail waitlist-signup" onSubmit={submit} aria-labelledby="waitlist-form-title" aria-busy={state === "pending"}>
      {state === "success" ? <div className="waitlist-success" role="status" aria-live="polite">
        <span className="waitlist-check" aria-hidden="true">✓</span>
        <h2 id="waitlist-form-title">You’re on the list.</h2>
        <p>We’ll email you when we launch. That’s all you need to do for now.</p>
        <Link className="link" href="/">Back to exploring <span aria-hidden="true">↗</span></Link>
      </div> : <>
        <div className="waitlist-form-intro">
          <h2 id="waitlist-form-title">Be there at launch.</h2>
          <p>Leave your email. We’ll let you know when the doors open.</p>
        </div>
        <label className="f" htmlFor="waitlist-email">Email address
          <input id="waitlist-email" type="email" name="email" autoComplete="email" inputMode="email" placeholder="you@company.com" maxLength={254} required readOnly={state === "pending"} />
        </label>
        <div hidden><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
        <label className="waitlist-consent">
          <input type="checkbox" name="consent" required disabled={state === "pending"} />
          <span>Email me when the platform launches.</span>
        </label>
        <button type="submit" className="btn btn-mint" disabled={state === "pending"}>{state === "pending" ? "Joining…" : "Join the waitlist"}<span aria-hidden="true"> →</span></button>
        {state === "error" && <p className="waitlist-error" role="alert">{error}</p>}
        <p className="form-note">Launch news only. No account needed.<br /><Link href="/legal/privacy">Privacy policy</Link></p>
      </>}
    </form>
  );
}
