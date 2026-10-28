import { env } from "cloudflare:workers";

export function isWaitlistOnly(): boolean {
  return env.PUBLIC_ACCESS === "waitlist";
}

export function signupDestination(dashOrigin: string): string {
  return isWaitlistOnly() ? "/waitlist" : `${dashOrigin}/signup`;
}
