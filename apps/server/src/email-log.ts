import { errorName } from "@jendal-workspace/core";
import { log } from "evlog";
import { z } from "zod";

const errorCodeSchema = z.object({ code: z.union([z.string(), z.number()]) });

// Logs never hold email addresses (parent spec §12.1); a short hash still links repeated failures.
export async function hashRecipient(email: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase()));
  return [...new Uint8Array(digest).slice(0, 8)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Email provider error messages can quote the recipient, so only the error's name and code are logged.
export async function logEmailError(cause: unknown, email: { kind: string; to: string }): Promise<void> {
  const parsed = errorCodeSchema.safeParse(cause);
  const code = parsed.success ? String(parsed.data.code) : undefined;
  log.error({
    action: "email.send",
    email: { kind: email.kind, recipientHash: await hashRecipient(email.to) },
    error: { name: errorName(cause), code },
  });
}
