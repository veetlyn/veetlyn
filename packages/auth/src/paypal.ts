const PAYPAL_LOGIN_SCOPES = "openid profile email https://uri.paypal.com/services/paypalattributes";

// PayPal's authorize page fails without a scope, but Better Auth's PayPal provider sends none and
// ignores `scope`. It keeps query parameters already present on `authorizationEndpoint`.
export function paypalAuthorizationEndpoint(live: boolean): string {
  const url = new URL(live ? "https://www.paypal.com/signin/authorize" : "https://www.sandbox.paypal.com/signin/authorize");
  url.searchParams.set("scope", PAYPAL_LOGIN_SCOPES);
  return url.toString();
}

type PayPalEmailEntry = { value: string; primary?: boolean; confirmed?: boolean };

type PayPalEmailFields = {
  email?: string;
  email_verified?: boolean;
  emails?: PayPalEmailEntry[];
};

type PayPalProfileEmail = { email?: string; emailVerified?: boolean };

// Better Auth reads `email`, but its userinfo call (schema=paypalv1.1) returns an `emails` list instead.
export function paypalEmail(profile: PayPalEmailFields): PayPalProfileEmail {
  if (profile.email) return { email: profile.email, emailVerified: profile.email_verified === true };
  const entry = profile.emails?.find((e) => e.primary) ?? profile.emails?.[0];
  return entry ? { email: entry.value, emailVerified: entry.confirmed === true } : {};
}
