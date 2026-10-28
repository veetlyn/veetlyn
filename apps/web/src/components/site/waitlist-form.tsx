"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

export default function WaitlistForm() {
  const [state, setState] = useState<"idle" | "pending" | "success" | "error">("idle");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "pending") return;
    const form = new FormData(event.currentTarget);
    setState("pending");
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), consent: form.get("consent") === "on", website: form.get("website") }),
      });
      setState(response.ok ? "success" : "error");
    } catch {
      setState("error");
    }
  }
  return (
    <form className="mail" onSubmit={submit}>
      {state === "success" ? <p role="status">You’re on the list. We’ll email you when we launch.</p> : <>
        <label className="f">Email address<input type="email" name="email" autoComplete="email" maxLength={254} required /></label>
        <div hidden><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
        <label><input type="checkbox" name="consent" required /> Email me when the platform launches.</label>
        <p className="form-note">Launch news only. No account is created. <Link href="/legal/privacy">Privacy policy</Link>.</p>
        <button type="submit" className="btn btn-mint" disabled={state === "pending"}>{state === "pending" ? "Joining…" : "Join the waitlist"}</button>
        {state === "error" && <p role="alert">We couldn’t add you just now. Please try again shortly.</p>}
      </>}
    </form>
  );
}
