import { log } from "evlog";

// Logs never hold email addresses (parent spec §12.1); a short hash still links repeated failures.
export async function hashRecipient(email: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase()));
  return [...new Uint8Array(digest).slice(0, 8)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Email provider error messages can quote the recipient, so only the error's name and code are logged.
export async function logEmailError(error: unknown, email: { kind: string; to: string }): Promise<void> {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
  log.error({
    action: "email.send",
    email: { kind: email.kind, recipientHash: await hashRecipient(email.to) },
    error: { name: error instanceof Error ? error.name : typeof error, code },
  });
}
