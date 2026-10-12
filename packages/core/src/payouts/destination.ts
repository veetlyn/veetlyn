export type PayoutDestinationDraft = { paypalPayerId: string; paypalEmail: string | null };

export type PayPalEmailEntry = { value?: string; primary?: boolean; confirmed?: boolean };

// PayPal's userinfo response (schema=paypalv1.1). Every field is optional: the decoder drops a field
// it cannot read, and the rules below treat a missing field as "PayPal did not confirm".
export type PayPalUserInfo = {
  user_id?: string;
  payer_id?: string;
  email?: string;
  email_verified?: boolean;
  emails?: PayPalEmailEntry[];
  // Formats like "18-24" or "65+"; PayPal documents it only as a string, and the sandbox never sends it.
  age_range?: string;
};

// PAYPAL_ID payouts take "the encrypted PayPal account number" (e.g. G83JXTJ5EHCQ2, Fact 14).
const PAYER_ID_PATTERN = /^[0-9A-Z]{13}$/;

function verifiedEmail(info: PayPalUserInfo): string | null {
  if (info.email !== undefined) return info.email_verified === true ? info.email : null;
  if (info.emails === undefined) return null;
  const entry = info.emails.find((candidate) => candidate.primary === true) ?? info.emails[0];
  return entry?.value !== undefined && entry.confirmed === true ? entry.value : null;
}

// `userInfo` is PayPal's own userinfo response, fetched server-side with the linked account's access
// token, so nothing here comes from the user. Its user_id must be the account ID Better Auth stored
// for the linked PayPal account; the payer ID is a separate field (Fact 14).
export function payoutDestinationFromUserInfo(
  paypalAccountId: string,
  userInfo: PayPalUserInfo | null,
): PayoutDestinationDraft | null {
  if (userInfo === null) return null;
  if (userInfo.user_id !== paypalAccountId) return null;
  if (userInfo.payer_id === undefined || !PAYER_ID_PATTERN.test(userInfo.payer_id)) return null;
  return { paypalPayerId: userInfo.payer_id, paypalEmail: verifiedEmail(userInfo) };
}

export type PayoutAge = { kind: "adult" } | { kind: "minor" } | { kind: "unknown" };

const ADULT_AGE = 18;

// The range's lower bound decides; without a readable one the member confirms their age themselves.
export function payoutAgeFromUserInfo(userInfo: PayPalUserInfo): PayoutAge {
  const lowerBound = /^\s*(\d+)/.exec(userInfo.age_range ?? "")?.[1];
  if (lowerBound === undefined) return { kind: "unknown" };
  return Number(lowerBound) >= ADULT_AGE ? { kind: "adult" } : { kind: "minor" };
}
