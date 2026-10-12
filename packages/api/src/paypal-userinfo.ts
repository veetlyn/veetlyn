import type { PayPalEmailEntry, PayPalUserInfo, TenantEnvironment } from "@jendal-workspace/core";
import { z } from "zod";

const USERINFO_URL = {
  sandbox: "https://api-m.sandbox.paypal.com/v1/identity/oauth2/userinfo?schema=paypalv1.1",
  live: "https://api-m.paypal.com/v1/identity/oauth2/userinfo?schema=paypalv1.1",
} satisfies Record<TenantEnvironment, string>;

// A field of the wrong type reads as absent rather than failing the whole response, so the payout
// rules decide on what PayPal did confirm.
const emailEntrySchema = z
  .looseObject({
    value: z.string().optional().catch(undefined),
    primary: z.boolean().optional().catch(undefined),
    confirmed: z.boolean().optional().catch(undefined),
  })
  .catch({}) satisfies z.ZodType<PayPalEmailEntry>;

const payPalUserInfoSchema = z.looseObject({
  user_id: z.string().optional().catch(undefined),
  payer_id: z.string().optional().catch(undefined),
  email: z.string().optional().catch(undefined),
  email_verified: z.boolean().optional().catch(undefined),
  emails: z.array(emailEntrySchema).optional().catch(undefined),
  age_range: z.string().optional().catch(undefined),
}) satisfies z.ZodType<PayPalUserInfo>;

// Null on any failure: the caller treats it as "PayPal did not confirm", and nothing here is logged,
// so the access token never reaches a log line.
export async function fetchPayPalUserInfo(
  environment: TenantEnvironment,
  accessToken: string,
): Promise<PayPalUserInfo | null> {
  try {
    const response = await fetch(USERINFO_URL[environment], {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    });
    if (!response.ok) return null;
    const parsed = payPalUserInfoSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
