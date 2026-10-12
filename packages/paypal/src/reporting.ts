import type { PayPalRequest } from "./client";
import { balancesSchema } from "./schemas";

// Amounts are PayPal value strings in the balance's currency.
export type PayPalBalance = { currency: string; total: string; available: string };

export type PayPalBalances = { accountId: string | null; balances: PayPalBalance[] };

export function createReporting(request: PayPalRequest) {
  return {
    // A 403 means the REST app is not allowed to read balances.
    async balances(currencyCode: string): Promise<PayPalBalances> {
      const body = await request(
        { method: "GET", path: `/v1/reporting/balances?currency_code=${encodeURIComponent(currencyCode)}` },
        balancesSchema,
      );
      return {
        accountId: body.account_id ?? null,
        balances: body.balances.map((balance) => ({
          currency: balance.currency,
          total: balance.total_balance.value,
          available: (balance.available_balance ?? balance.total_balance).value,
        })),
      };
    },
  };
}
