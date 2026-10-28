import { z } from "zod";

// Omitted deployment settings must keep the public launch closed, without breaking demos.
export function launchAccess(stage: string | undefined, override: string | undefined): "waitlist" | "open" {
  return z.enum(["waitlist", "open"]).parse(override || (stage === "production" ? "waitlist" : "open"));
}
