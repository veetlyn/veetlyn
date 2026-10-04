export const RESERVED_SLUGS: readonly string[] = [
  "www",
  "admin",
  "api",
  "mcp",
  "store",
  "app",
  "docs",
  "login",
  "signup",
  "logout",
  "account",
  "settings",
  "orgs",
  "new",
  "verify-email",
  "forgot-password",
  "reset-password",
  "trpc",
  "assets",
  "static",
];

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export type SlugValidation = { ok: true; slug: string } | { ok: false; reason: "format" | "reserved" };

export function validateStoreSlug(input: string): SlugValidation {
  const slug = input.trim().toLowerCase();
  // "--" is rejected so slugs can never look like punycode labels ("xn--").
  if (!SLUG_PATTERN.test(slug) || slug.includes("--")) {
    return { ok: false, reason: "format" };
  }
  if (RESERVED_SLUGS.includes(slug)) {
    return { ok: false, reason: "reserved" };
  }
  return { ok: true, slug };
}
