import type { PayPalRequest } from "./client";
import { balancesSchema } from "./schemas";

// A balance can be negative (PayPal reports an overdrawn account as "-12.34").
export type PayPalBalance = { currency: string; totalMinor: number; availableMinor: number };

export type PayPalBalances = { accountId: string | null; balances: PayPalBalance[] };

const SIGNED_VALUE = /^(-)?(\d{1,12})(?:\.(\d{1,2}))?$/;

function signedValueMinor(value: string): number | null {
  const match = SIGNED_VALUE.exec(value.trim());
  if (!match) return null;
  const minor = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  return match[1] && minor > 0 ? -minor : minor;
}

export function createReporting(request: PayPalRequest) {
  return {
    // Needs the team's first-party credentials with the PAYPAL_BALANCE feature; otherwise PayPal answers 403.
    // A balance whose amounts cannot be read is left out.
    async balances(currencyCode: string): Promise<PayPalBalances> {
      const body = await request(
        { method: "GET", path: `/v1/reporting/balances?currency_code=${encodeURIComponent(currencyCode)}` },
        balancesSchema,
      );
      return {
        accountId: body.account_id ?? null,
        balances: body.balances.flatMap((balance) => {
          const totalMinor = signedValueMinor(balance.total_balance.value);
          const availableMinor = signedValueMinor((balance.available_balance ?? balance.total_balance).value);
          if (totalMinor === null || availableMinor === null) return [];
          return [{ currency: balance.currency, totalMinor, availableMinor }];
        }),
      };
    },
  };
}
