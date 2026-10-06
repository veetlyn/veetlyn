export type PayoutDestinationDraft = { paypalPayerId: string; paypalEmail: string | null };

type PayPalEmailEntry = { value?: unknown; primary?: unknown; confirmed?: unknown };

type PayPalUserInfo = {
  user_id?: unknown;
  payer_id?: unknown;
  email?: unknown;
  email_verified?: unknown;
  emails?: unknown;
};

// PAYPAL_ID payouts take "the encrypted PayPal account number" (e.g. G83JXTJ5EHCQ2, Fact 14).
const PAYER_ID_PATTERN = /^[0-9A-Z]{13}$/;

function verifiedEmail(info: PayPalUserInfo): string | null {
  if (typeof info.email === "string") return info.email_verified === true ? info.email : null;
  if (!Array.isArray(info.emails)) return null;
  const entries = info.emails as PayPalEmailEntry[];
  const entry = entries.find((candidate) => candidate.primary === true) ?? entries[0];
  return entry && typeof entry.value === "string" && entry.confirmed === true ? entry.value : null;
}

// `userInfo` is PayPal's own userinfo response, fetched server-side with the linked account's access
// token, so nothing here comes from the user. Its user_id must be the account ID Better Auth stored
// for the linked PayPal account; the payer ID is a separate field (Fact 14).
export function payoutDestinationFromUserInfo(
  paypalAccountId: string,
  userInfo: unknown,
): PayoutDestinationDraft | null {
  if (typeof userInfo !== "object" || userInfo === null) return null;
  const info = userInfo as PayPalUserInfo;
  if (info.user_id !== paypalAccountId) return null;
  if (typeof info.payer_id !== "string" || !PAYER_ID_PATTERN.test(info.payer_id)) return null;
  return { paypalPayerId: info.payer_id, paypalEmail: verifiedEmail(info) };
}
