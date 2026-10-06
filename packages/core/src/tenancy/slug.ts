export const RESERVED_SLUGS: readonly string[] = [
  // Platform host labels
  "www",
  "admin",
  "api",
  "mcp",
  "store",
  "shop",
  "app",
  "docs",
  "mail",
  "status",
  "help",
  "support",
  "blog",
  "cdn",
  "dashboard",
  "auth",
  "oauth",
  "checkout",
  "pay",
  "payments",
  "billing",
  // Environments
  "dev",
  "staging",
  "preview",
  "sandbox",
  "test",
  "demo",
  // Mail and DNS
  "email",
  "smtp",
  "imap",
  "autodiscover",
  "autoconfig",
  "ns1",
  "ns2",
  // Trust and brands
  "security",
  "abuse",
  "payleor",
  "paypal",
  "venmo",
  "braintree",
  // Agents
  "agent",
  "agents",
  // The admin's own top-level paths
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

const SLUG_MAX_LENGTH = 40;
const FALLBACK_SUFFIX = "-store";

function trimHyphens(value: string): string {
  return value.replace(/^-+|-+$/g, "");
}

// Returns "" when the name has no usable letters or digits; the merchant then types an address.
export function suggestStoreSlug(name: string): string {
  const base = trimHyphens(
    trimHyphens(
      name
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-"),
    ).slice(0, SLUG_MAX_LENGTH),
  );
  if (!base) return "";
  if (validateStoreSlug(base).ok) return base;
  const withSuffix = `${trimHyphens(base.slice(0, SLUG_MAX_LENGTH - FALLBACK_SUFFIX.length))}${FALLBACK_SUFFIX}`;
  return validateStoreSlug(withSuffix).ok ? withSuffix : "";
}

export type StoreSlugProblem = "format" | "reserved" | "taken";

export function storeSlugProblem(problem: StoreSlugProblem): string {
  switch (problem) {
    case "format":
      return "Use 3 to 40 lowercase letters, numbers or single hyphens.";
    case "reserved":
      return "This store address is reserved.";
    case "taken":
      return "This store address is already taken.";
  }
}
