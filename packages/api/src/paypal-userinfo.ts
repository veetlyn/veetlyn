import type { TenantEnvironment } from "@jendal-workspace/core";

const USERINFO_URL: Record<TenantEnvironment, string> = {
  sandbox: "https://api-m.sandbox.paypal.com/v1/identity/oauth2/userinfo?schema=paypalv1.1",
  live: "https://api-m.paypal.com/v1/identity/oauth2/userinfo?schema=paypalv1.1",
};

// Null on any failure: the caller treats it as "PayPal did not confirm", and nothing here is logged,
// so the access token never reaches a log line.
export async function fetchPayPalUserInfo(environment: TenantEnvironment, accessToken: string): Promise<unknown> {
  try {
    const response = await fetch(USERINFO_URL[environment], {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}
