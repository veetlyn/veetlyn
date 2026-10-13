import { z } from "zod";

// Response schemas read only the fields Payleor uses. Top-level objects are loose and every field PayPal may
// omit is optional, so a valid response never fails; `.catch` marks the fields that were always read leniently.

export function parsedItems<T extends z.ZodType>(schema: T, values: readonly unknown[]): z.output<T>[] {
  return values.flatMap((value) => {
    const parsed = schema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}

// A missing or non-array value reads as empty, and items that fail their schema are dropped.
function lenientArray<T extends z.ZodType>(item: T) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((values) => parsedItems(item, values));
}

const optionalText = z.string().optional().catch(undefined);
const optionalFlag = z.boolean().optional().catch(undefined);

const jsonSchema = z.json();
// A JSON.parse result, before any schema has read it.
export type JsonBody = z.output<typeof jsonSchema>;

export const tokenResponseSchema = z.looseObject({
  access_token: z.string(),
  expires_in: z.number().optional().catch(undefined),
  // Space-separated scope URIs granted to the token.
  scope: z.string().optional().catch(undefined),
});

export const storedTokenSchema = z.object({ accessToken: z.string(), expiresAt: z.number() });

// Error bodies carry name, message, details and debug_id (Fact 3).
export const errorBodySchema = z.looseObject({
  name: optionalText,
  message: optionalText,
  debug_id: optionalText,
  details: lenientArray(
    z.object({ field: optionalText, value: optionalText, issue: optionalText, description: optionalText }),
  ),
  links: lenientArray(z.looseObject({ href: z.string(), rel: optionalText, method: optionalText })),
});

export const moneySchema = z.object({ currency_code: z.string(), value: z.string() });
const readableMoney = moneySchema.optional().catch(undefined);

// A fee that is present but unreadable fails the whole breakdown: dropping it would later record the fee as zero.
// Amounts that never become a fee stay lenient: an unreadable one reads as absent and leaves the fees intact.
export const captureBreakdownSchema = z.object({
  paypal_fee: moneySchema.optional(),
  platform_fees: z.array(z.object({ amount: moneySchema })).default(() => []),
  net_amount: readableMoney,
  // Present only when the seller's account holds another currency than the capture's.
  receivable_amount: readableMoney,
  exchange_rate: z
    .object({ value: z.string(), source_currency: z.string(), target_currency: z.string() })
    .optional()
    .catch(undefined),
});

// The fees a refund returns to the seller, read strict-or-undefined like the capture's breakdown.
export const refundBreakdownSchema = z.object({
  paypal_fee: moneySchema.optional(),
  platform_fees: z.array(z.object({ amount: moneySchema })).default(() => []),
  net_amount: readableMoney,
});

export const captureSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount: readableMoney,
  custom_id: optionalText,
  create_time: optionalText,
  // Missing while a capture is pending (R1 facts §2).
  seller_receivable_breakdown: captureBreakdownSchema.optional().catch(undefined),
});

export const refundSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount: readableMoney,
  // Missing while a refund is pending.
  seller_payable_breakdown: refundBreakdownSchema.optional().catch(undefined),
});

// Captures and refunds stay unread here: captureFromOrder and refundsFromOrder skip the items they cannot read.
// A purchase unit, payments or list of the wrong type reads as absent, that is as no captures or refunds.
export const orderSchema = z.looseObject({
  id: z.string(),
  status: z.string(),
  purchase_units: z
    .array(
      z
        .looseObject({
          payments: z
            .looseObject({
              captures: z.array(z.unknown()).optional().catch(undefined),
              refunds: z.array(z.unknown()).optional().catch(undefined),
            })
            .optional()
            .catch(undefined),
        })
        .optional()
        .catch(undefined),
    )
    .optional()
    .catch(undefined),
});

// The 201 response is only a links array (Fact 1).
export const partnerReferralSchema = z.looseObject({
  links: z.array(z.looseObject({ href: z.string(), rel: z.string(), method: z.string().optional() })),
});

export const sellerCredentialsSchema = z.looseObject({
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  payer_id: z.string().min(1),
});

// Field list from the live doc's sample responses (Fact 5).
export const merchantIntegrationSchema = z.looseObject({
  merchant_id: optionalText,
  tracking_id: optionalText,
  payments_receivable: optionalFlag,
  primary_email: optionalText,
  primary_email_confirmed: optionalFlag,
  legal_name: optionalText,
  country: optionalText,
  products: lenientArray(z.looseObject({ name: z.string().catch(""), status: optionalText, vetting_status: optionalText })),
  capabilities: lenientArray(z.looseObject({ name: z.string().catch(""), status: optionalText })),
  oauth_integrations: lenientArray(
    z.looseObject({
      integration_type: optionalText,
      integration_method: optionalText,
      status: optionalText,
      oauth_third_party: lenientArray(
        z.looseObject({
          partner_client_id: optionalText,
          merchant_client_id: optionalText,
          scopes: lenientArray(z.string()),
        }),
      ),
    }),
  ),
});

// A body that is not an object reads as "no integration yet", like one without a merchant_id.
export const merchantIntegrationRefSchema = z
  .looseObject({ merchant_id: optionalText, tracking_id: optionalText })
  .catch({ merchant_id: undefined, tracking_id: undefined });

// Payouts money is { value, currency }, unlike the { currency_code, value } of the other APIs.
export const payoutMoneySchema = z.object({ value: z.string(), currency: z.string() });

// Statuses stay plain strings: PayPal adds new ones, and callers read an unknown status as still pending.
const payoutBatchHeaderSchema = z.looseObject({ payout_batch_id: z.string(), batch_status: z.string() });

export const payoutBatchCreatedSchema = z.looseObject({ batch_header: payoutBatchHeaderSchema });

// An unreadable fee reads as absent so the item, and its status, are still read.
export const payoutBatchSchema = z.looseObject({
  batch_header: payoutBatchHeaderSchema,
  items: lenientArray(
    z.looseObject({
      payout_item_id: z.string(),
      transaction_status: optionalText,
      payout_item_fee: payoutMoneySchema.optional().catch(undefined),
      payout_item: z.looseObject({ sender_item_id: optionalText }).optional().catch(undefined),
      errors: z.looseObject({ name: z.string(), message: z.string().catch("") }).optional().catch(undefined),
    }),
  ),
});

export const balancesSchema = z.looseObject({
  account_id: optionalText,
  balances: lenientArray(
    z.looseObject({
      currency: z.string(),
      total_balance: moneySchema,
      available_balance: readableMoney,
    }),
  ),
});

export const webhookVerificationSchema = z.looseObject({ verification_status: optionalText });

// Webhook fields are read leniently: an empty or non-string id reads as unknown (null).
const webhookText = z.string().min(1).nullable().catch(null);
const webhookMerchant = z.looseObject({ merchant_id: webhookText }).nullable().catch(null);

export const webhookUnitSchema = z.looseObject({ custom_id: webhookText, payee: webhookMerchant });

const webhookResourceSchema = z.looseObject({
  id: webhookText,
  custom_id: webhookText,
  payee: webhookMerchant,
  payer: webhookMerchant,
  links: lenientArray(z.looseObject({ href: webhookText, rel: webhookText })),
  purchase_units: z.array(z.unknown()).nullable().catch(null),
  supplementary_data: z
    .looseObject({ related_ids: z.looseObject({ order_id: webhookText }).nullable().catch(null) })
    .nullable()
    .catch(null),
});

export const webhookEventSchema = z.looseObject({
  id: z.string().min(1),
  event_type: z.string().min(1),
  resource_type: webhookText,
  resource: webhookResourceSchema.nullable().catch(null),
});
