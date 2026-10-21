import { env } from "cloudflare:workers";
import { z } from "zod";

// The product name people read; set per stage (PLATFORM_NAME).
export function platformName(): string {
  return z.string().min(1).parse(env.PLATFORM_NAME);
}
