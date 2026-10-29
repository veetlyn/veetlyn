# Run 1: PayPal facts for payments and webhooks

Checked 2026-10-07.

Path shortcuts used below:

- `ORD` = `refs/paypal/paypal-rest-api-specifications/openapi/checkout_orders_v2.json`
- `PAY` = `refs/paypal/paypal-rest-api-specifications/openapi/payments_payment_v2.json`
- `WH` = `refs/paypal/paypal-rest-api-specifications/openapi/notifications_webhooks_v1.json`
- `V6` = `refs/paypal/paypal-js/packages/paypal-js/types/v6`
- `AIT` = `refs/paypal/AI-Toolkit/skills/paypal-best-practices/references`
- `RH` = `refs/paypal/ruleshub/paypal-checkout/enterprise-checkout`
- `SDK` = `refs/paypal/PayPal-TypeScript-Server-SDK`

Live pages were read on 2026-10-07. Where a page offers a `.md` version, that version was read; line numbers in live pages are not stable, so live facts cite the URL and section.

## 1. Create order for a seller (multiparty, immediate capture)

### Headers

- `POST /v2/checkout/orders` accepts these headers: `PayPal-Request-Id`, `PayPal-Partner-Attribution-Id`, `PayPal-Client-Metadata-Id`, `Prefer`, `Authorization`, `PayPal-Auth-Assertion`. The spec marks all of them `required: false`. (`ORD:48-114`)
- `Authorization: Bearer <access token>` is needed on every REST call. (https://developer.paypal.com/api/rest/requests/ #authorization)
- `PayPal-Partner-Attribution-Id` is the BN code. The spec caps it at 36 characters. (`ORD:73-84`) The live docs call it "Required for multiparty payments". (https://developer.paypal.com/api/rest/requests/ #paypal-partner-attribution-id)
- `PayPal-Request-Id` is 1 to 108 characters. The server keeps keys for 6 hours, or up to 72 hours on request to an account manager. It is mandatory only for single-step creates that carry a payment source such as a card or vault ID. (`ORD:49-59`) Our flow has no `payment_source` at create time, so the spec does not force it, but the project rule is to send it on every POST. (`refs/AGENTS.md`, "Default decisions")
- `Prefer`: `return=minimal` is the default and returns only `id`, `status` and HATEOAS links. `return=representation` returns the full order. (`ORD:88-107`, `ORD:324-325`)
- **`PayPal-Auth-Assertion`:**
  - The spec describes it as a JWT that identifies the merchant, and says consent to act on behalf of the merchant is a prerequisite. It is optional in the spec. (`ORD:4137-4156`)
  - The live multiparty "Immediate capture" guide sends it on create, on capture and on show order, together with `PayPal-Partner-Attribution-Id`. The same guide also tells you to set `purchase_units[].payee` for the end receiver. (https://developer.paypal.com/platforms/checkout/immediate-capture, steps 1 to 4)
  - The live multiparty "Integrate PayPal Checkout" guide also sends it on create and capture. (https://developer.paypal.com/platforms/checkout/standard/integrate/, "Back-end code")
  - The ruleshub snippet calls it "required for partner-initiated seller transactions" and sends it together with `payee.merchant_id`. (`RH/snippets/javascript/multiparty-create-order.md:5,52-54,87,109`) The capture snippet reuses it. (`RH/snippets/javascript/multiparty-capture.md:3,26`)
  - No source says what PayPal does if `payee.merchant_id` is set and the assertion is missing. **Decision basis:** send it on create, capture and show order, as the live guides do.
- **Building the assertion** (no Node `crypto` needed; `btoa` works in Workers):
  - Header `{"alg":"none"}`. Payload `{"iss": "<partner client_id>", "payer_id": "<seller merchant id>"}`; `email` may replace `payer_id`, but PayPal recommends `payer_id` because emails change.
  - The signature is empty, so the value ends with a period: `<b64(header)>.<b64(payload)>.`
  - A signed JWT is allowed, using the client secret.
  - (https://developer.paypal.com/api/rest/requests/ #paypal-auth-assertion; https://developer.paypal.com/platforms/checkout/immediate-capture step 1)
  - The ruleshub snippet says it must be a *signed* JWT. That conflicts with the live docs; see Conflicts. (`RH/snippets/javascript/multiparty-create-order.md:9`)

### Body schema

- `order_request` requires `intent` and `purchase_units`. Allowed intents are `CAPTURE` and `AUTHORIZE`. Orders carry 1 to 10 purchase units. Top-level `payer` is deprecated in favour of `payment_source.paypal`. (`ORD:8886-8941`, `ORD:4175-4183`)
- `purchase_unit_request` requires only `amount`. (`ORD:5708-5715`)
  - `reference_id`: up to 256 characters. PayPal sets it to `default` when there is one unit and you omit it. (`ORD:5716-5722`)
  - `custom_id`: 1 to 255 characters. It is not shown to the payer and appears in reports. (`ORD:5753-5759`)
  - `invoice_id`: 1 to 127 characters. It is shown to the payer and must be unique per merchant account by default. (`ORD:5760-5766`)
  - `description`: up to 3000 characters are accepted, but the value is cut to 127 characters. (`ORD:5746-5752`)
  - `soft_descriptor`: cut to 22 characters. (`ORD:5767-5773`)
- `payee` (`payee_base`) has two fields: `email_address` (3 to 254 characters) and `merchant_id`. `merchant_id` is a 13-character PayPal account ID matching `^[2-9A-HJ-NP-Z]{13}$`. (`ORD:4748-4774`, `ORD:4192-4199`, `ORD:4808-4820`)
  - Use `merchant_id`. It is stable, while email is not (same reasoning PayPal gives for the assertion). (https://developer.paypal.com/api/rest/requests/ #build-the-jwt)
  - A bad payee returns 422 `PAYEE_ACCOUNT_INVALID` ("Ensure that either `payee.merchant_id` or `payee.email_address` is specified"). (https://developer.paypal.com/api/rest/reference/orders/v2/errors/, Create order)
- `payment_instruction` (`ORD:4863-4908`):
  - `platform_fees[]` holds 0 to 1 items. It only works for accounts enabled for the platform capability. (`ORD:4868-4883`)
  - `disbursement_mode` is `INSTANT` (default) or `DELAYED`. (`ORD:4853-4862`, `ORD:4884-4893`)
- `platform_fee` requires `amount`, which is a `money` object. `payee` is optional, is a `payee_base`, and names the fee recipient. (`ORD:4821-4852`)
- `money` requires `currency_code` and `value`. `value` is a **string**, up to 32 characters, matching `^((-?[0-9]+)|(-?([0-9]+)?[.][0-9]+))$`. Decimal places follow the currency. (`ORD:4619-4639`)
- Fee currency must match the transaction currency. (`RH/rules.md:146-150`, which also says the fee payee needs a bank account, fees settle daily, and fees are not supported for first-party integrations; `RH/snippets/javascript/multiparty-create-order.md:107`) Mixed currencies in one order fail with `MULTI_CURRENCY_ORDER`. (https://developer.paypal.com/api/rest/reference/orders/v2/errors/, Create order)
- Fee-related create errors (all 422) (https://developer.paypal.com/api/rest/reference/orders/v2/errors/, Create order):
  - `PLATFORM_FEES_NOT_SUPPORTED`: the caller is not enabled.
  - `INVALID_PLATFORM_FEES_ACCOUNT`: the fee payee is invalid or its setup is incomplete.
  - `INVALID_PLATFORM_FEES_AMOUNT`: the fee is greater than the order amount.
  - `PAYEE_NOT_CONSENTED` (403 `NOT_AUTHORIZED`): the seller has not consented.
- The seller must be onboarded with the `PARTNER_FEE` feature to use `platform_fees`. (https://developer.paypal.com/platforms/checkout/immediate-capture, step 2)

### `experience_context` and v6 buttons

- `payment_source.paypal.experience_context` (`ORD:6880-6994`) has these fields:
  - `brand_name`: up to 127 characters.
  - `locale`
  - `shipping_preference`: `GET_FROM_FILE` (default), `NO_SHIPPING`, `SET_PROVIDED_ADDRESS`.
  - `contact_preference`
  - `return_url`, `cancel_url`
  - `app_switch_context`
  - `landing_page`: `LOGIN`, `GUEST_CHECKOUT`, `NO_PREFERENCE` (default), `BILLING`.
  - `user_action`: `CONTINUE` (default) or `PAY_NOW`.
  - `payment_method_preference`: `UNRESTRICTED` (default) or `IMMEDIATE_PAYMENT_REQUIRED`.
  - `order_update_callback_config`
- Partner account settings can override `brand_name` and `shipping_preference`. (`ORD:6882`)
- Use `experience_context`, not the deprecated top-level `application_context`. (`RH/snippets/javascript/multiparty-create-order.md:3,108`)
- Return and cancel URLs are needed only for the v6 `redirect` presentation mode ("Requires a return/cancel URL"). `auto`, `popup` and `modal` do not list that requirement. (https://developer.paypal.com/sdk/js/reference, `paymentSession.start` options)
- The v6 session option `commit` defaults to `true` ("Pay Now"). (https://developer.paypal.com/sdk/js/reference, `createPayPalOneTimePaymentSession`) No source says whether `user_action` on the order must match `commit`.

### Minimal request

The live guide's create sample has only `intent` plus one unit with `amount` and `payment_instruction`. (https://developer.paypal.com/platforms/checkout/immediate-capture, step 2) Our minimal body adds payee, custom_id and invoice_id:

```http
POST https://api-m.sandbox.paypal.com/v2/checkout/orders
Authorization: Bearer <token>
Content-Type: application/json
PayPal-Request-Id: <uuid stored with our payment row>
PayPal-Partner-Attribution-Id: <BN code>
PayPal-Auth-Assertion: <b64({"alg":"none"})>.<b64({"iss":"<partner client id>","payer_id":"<seller merchant id>"})>.
Prefer: return=minimal
```

```json
{
  "intent": "CAPTURE",
  "purchase_units": [
    {
      "reference_id": "default",
      "custom_id": "<our payment id>",
      "invoice_id": "<unique per seller>",
      "amount": { "currency_code": "USD", "value": "100.00" },
      "payee": { "merchant_id": "<seller merchant id>" },
      "payment_instruction": {
        "disbursement_mode": "INSTANT",
        "platform_fees": [{ "amount": { "currency_code": "USD", "value": "5.00" } }]
      }
    }
  ],
  "payment_source": {
    "paypal": { "experience_context": { "user_action": "PAY_NOW", "shipping_preference": "NO_SHIPPING" } }
  }
}
```

- The order is created with status `CREATED`. Order statuses are `CREATED`, `SAVED`, `APPROVED`, `VOIDED`, `COMPLETED`, `PAYER_ACTION_REQUIRED`. (`ORD:12622-12634`)
- The create response is `201`. A replay with the same `PayPal-Request-Id` returns `200`. (`ORD:290-291`, `ORD:324-325`)

## 2. Capture

- The endpoint is `POST /v2/checkout/orders/{id}/capture`. The order must be approved by the buyer first. (`ORD:2145-2150`; https://developer.paypal.com/platforms/checkout/immediate-capture, step 3 note)
- Headers are `PayPal-Request-Id`, `Prefer`, `PayPal-Client-Metadata-Id`, `Authorization`, `PayPal-Auth-Assertion`. (`ORD:2161-2300`) The live multiparty guide sends `PayPal-Partner-Attribution-Id` and `PayPal-Auth-Assertion` with a body of `{}`. (https://developer.paypal.com/platforms/checkout/immediate-capture, step 3)
- **Idempotency:**
  - The first successful capture returns `201 Created`. "If a duplicate response is retried, returns the HTTP `200 OK` status code" with the captured payment details. (`ORD:2409-2410`, `ORD:2301-2302`)
  - The same key and window rules apply as on create: 6 hours by default, up to 72 hours. (`ORD:2163-2172`)
  - A parallel retry while the first call is still running returns `409 RESOURCE_CONFLICT` / `PREVIOUS_REQUEST_IN_PROGRESS`. (https://developer.paypal.com/api/rest/reference/orders/v2/errors/, Capture order)
  - After a 5xx or a timeout on `/capture`, PayPal says to repeat the call at least once with the same `PayPal-Request-Id`. (https://developer.paypal.com/api/rest/responses/, "HTTP 5XX status codes")
- **`Prefer`:** the capture response is minimal by default. Send `Prefer: return=representation` to get the full resource. (`ORD:2202`, `ORD:2410`) The minimal idempotent example still contains `purchase_units[].payments.captures[]`. (`ORD:2309-2404`)
- **Response fields to read**, at `purchase_units[0].payments.captures[0]`:
  - `id`, `status`, `status_details.reason`, `amount`, `invoice_id`, `custom_id` (up to 255 characters), `final_capture`, `disbursement_mode`, `seller_protection`, `links`. (`ORD:12032-12132`)
  - `seller_receivable_breakdown`, which requires `gross_amount` and has `paypal_fee`, `platform_fees[]` (0 to 1 items), `net_amount`, `receivable_amount` and `exchange_rate`. `net_amount = gross_amount - paypal_fee - platform_fees`. The breakdown is not present while the capture is pending. (`ORD:11946-12031`)
  - The spec's multiparty example shows a capture with `platform_fees[0].payee.merchant_id`, `custom_id`, `invoice_id`, and an `up` link to the order. (`ORD:2560-2598`)
- **Capture statuses:** `COMPLETED`, `DECLINED`, `PARTIALLY_REFUNDED`, `PENDING`, `REFUNDED`, `FAILED`. (`ORD:11879-11910`; the same list is at `PAY:4277-4306`)
- **`status_details.reason`** (for `PENDING` or `DENIED`): `BUYER_COMPLAINT`, `CHARGEBACK`, `ECHECK`, `INTERNATIONAL_WITHDRAWAL`, `OTHER`, `PENDING_REVIEW`, `RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION`, `REFUNDED`, `TRANSACTION_APPROVED_AWAITING_FUNDING`, `UNILATERAL`, `VERIFICATION_REQUIRED`, `DECLINED_BY_RISK_FRAUD_FILTERS`. (`ORD:11853-11878`)
- A processor decline on an external processor can return `201` with a capture `status` of `DECLINED`, not an HTTP error. (https://developer.paypal.com/platforms/checkout/standard/integrate/, "Processor response codes")
- **Error shape:**
  - `error` requires `name`, `message` and `debug_id`, and may carry `details[]` and `links[]`. (`ORD:9219-9280`)
  - Each `details[]` entry requires `issue` and may carry `field`, `value`, `location` (`body`, `path` or `query`), `description` and `links`. (`ORD:9155-9218`)
  - Do not depend on `description` text; PayPal may change it. (`ORD:9211`)
- **Capture errors** (from https://developer.paypal.com/api/rest/reference/orders/v2/errors/, Capture order; all are `UNPROCESSABLE_ENTITY`, HTTP 422):
  - `INSTRUMENT_DECLINED`: "The instrument presented was either declined by the processor or bank, or it can't be used for this payment."
  - `ORDER_ALREADY_CAPTURED`: "Order already captured. If 'intent=CAPTURE' only one capture per order is allowed."
  - `PAYER_ACTION_REQUIRED`: "instruct the buyer to return to PayPal". It comes with a `payer-action` link. (example at `ORD:2682-2708`, `ORD:15862-15901`)
  - `ORDER_NOT_APPROVED`, `TRANSACTION_REFUSED`, `MAX_NUMBER_OF_PAYMENT_ATTEMPTS_EXCEEDED`, `DUPLICATE_INVOICE_ID`.
  - `ACTION_DOES_NOT_MATCH_INTENT` when the order was created with `AUTHORIZE`. (`ORD:2709-2729`)
  - The capture endpoint also returns `400`, `401`, `403`, `404` and `409`. (`ORD:2645-2673`)
- Example 422 body:

```json
{
  "name": "UNPROCESSABLE_ENTITY",
  "details": [{ "issue": "INSTRUMENT_DECLINED", "description": "The instrument presented was either declined ..." }],
  "message": "The requested action could not be performed, semantically incorrect, or failed business validation.",
  "debug_id": "f63fbc340a6ce",
  "links": [{ "href": "https://developer.paypal.com/api/orders/v2/#error-INSTRUMENT_DECLINED", "rel": "information_link", "method": "GET" }]
}
```

(Shape from `ORD:2685-2707`. The issue text is from the live errors page.)

- **Handling guidance:**
  - Treat `INSTRUMENT_DECLINED` as recoverable. Ask the buyer for another payment method and do not retry the same instrument. (`AIT/js-sdk-v6.md:695,726`; `refs/paypal/AI-Toolkit/commands/explain-error.md:27`)
  - Log `debug_id` from every error. (`AIT/js-sdk-v6.md:727`)

## 3. Show order and get capture

- **`GET /v2/checkout/orders/{id}`** accepts `Authorization`, `PayPal-Auth-Assertion` and `fields`. (`ORD:689-700`; parameter list from the spec) The live multiparty guide sends `PayPal-Partner-Attribution-Id` and `PayPal-Auth-Assertion` on it. (https://developer.paypal.com/platforms/checkout/immediate-capture, step 4) Orders get errors include `403 NOT_AUTHORIZED / PERMISSION_DENIED`. (https://developer.paypal.com/api/rest/reference/orders/v2/errors/, Get order)
- **`GET /v2/payments/captures/{capture_id}`** declares only `capture_id` and `Authorization`; it has **no** `PayPal-Auth-Assertion` parameter. (`PAY:1409-1450`) The server SDK matches: `getCapturedPayment` takes only `captureId` and `paypalMockResponse`. (`SDK/src/controllers/paymentsController.ts:380-400`) No live doc was found that says whether a partner token can read a seller's capture without the assertion.
- **`GET /v2/payments/refunds/{refund_id}`** accepts `PayPal-Auth-Assertion`. (`PAY:2648`; parameter list from the spec)
- **Three-party note:** for three-party transactions, the partner "must identify the merchant using either a PayPal-Auth-Assertion header or an access token with target_subject". (`SDK/src/controllers/paymentsController.ts:39-44`; the same text is on other payments methods)
- **Re-fetch for the webhook processor** (inferred from the above):
  - capture events: `GET /v2/payments/captures/{resource.id}`, or `GET /v2/checkout/orders/{resource.supplementary_data.related_ids.order_id}` with the assertion;
  - refund events: `GET /v2/payments/refunds/{resource.id}` with the assertion;
  - order events: `GET /v2/checkout/orders/{resource.id}` with the assertion.
- The capture schema returned by Payments v2 (`capture-2`) also carries `supplementary_data.related_ids` (`order_id`, `authorization_id`, `capture_id`; each 1 to 20 characters, `^[A-Z0-9]+$`) and `payee` (`payee_base`). (`PAY:4795-4830`, `PAY:3996-4040`)

## 4. Webhooks

### Verification

- **Postback API:** `POST /v1/notifications/verify-webhook-signature`. (`WH:467-569`)
  - Required request fields (`WH:1621-1675`):
    - `auth_algo` (from the `PAYPAL-AUTH-ALGO` header, up to 100 characters)
    - `cert_url` (`PAYPAL-CERT-URL`, up to 500)
    - `transmission_id` (`PAYPAL-TRANSMISSION-ID`, up to 50)
    - `transmission_sig` (`PAYPAL-TRANSMISSION-SIG`, up to 500)
    - `transmission_time` (`PAYPAL-TRANSMISSION-TIME`, up to 100)
    - `webhook_id` (ours, from the dashboard or create call, up to 50)
    - `webhook_event` (the event body)
  - Response: `{"verification_status": "SUCCESS" | "FAILURE"}`. (`WH:1676-1688`)
  - OAuth scopes: `.../applications/webhooks` or `.../applications/verify-webhook-signature`. (`WH:559-566`)
  - Post `webhook_event` back exactly as received. Parsing and re-serializing can fail verification. (https://developer.paypal.com/api/rest/webhooks/rest/, "Postback method")
  - Postback does not work for simulator mock events. (https://developer.paypal.com/api/rest/webhooks/rest/, "Test the listener with mock events")
- **Headers PayPal sends** (lower-case in the live sample): `paypal-transmission-id`, `paypal-transmission-time`, `paypal-transmission-sig`, `paypal-cert-url`, `paypal-auth-algo`. (https://developer.paypal.com/api/rest/webhooks/rest/, "Self verification method"; `WH:1626-1661`) The sample also logs `correlation-id`. (same page)
- **Offline (self) verification**, for reference only:
  1. Build the message `transmissionId|timeStamp|webhookId|crc32`, where `crc32` is the decimal CRC32 of the **raw** body.
  2. Download and cache the certificate at `paypal-cert-url`.
  3. Verify `paypal-transmission-sig` (base64) over the message with SHA256 and RSA.
  4. PayPal calls this "the preferred method".
  5. Simulator events use the webhook ID string `WEBHOOK_ID`.
  - (https://developer.paypal.com/api/rest/webhooks/rest/, "Self verification method"; https://developer.paypal.com/api/rest/webhooks/, "Verifying the message received")
  - Runtime note (not a PayPal fact): Web Crypto `importKey` accepts `spki`, not an X.509 certificate, so offline verification in Workers would need the public key extracted from the PEM certificate. (https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/importKey)
- **Delivery:**
  - Any non-2xx response triggers retries, up to 25 times over 3 days. After that the delivery is marked Failed and can be resent from the dashboard. (https://developer.paypal.com/api/rest/webhooks/, "Receiving the message")
  - PayPal delivers only to HTTPS on port 443. (https://developer.paypal.com/api/rest/webhooks/rest/, "Subscribing a listener URL")
  - Return 200 fast; PayPal retries when it gets no 200 within 30 seconds. (`AIT/webhooks.md:15`)

### Event names and resource types

| Purpose | Event | Resource type | Source |
|---|---|---|---|
| Buyer approved order | `CHECKOUT.ORDER.APPROVED` | Orders v2 order (resource_type string not found locally) | https://developer.paypal.com/api/rest/webhooks/event-names/ (Orders V2) |
| Order processed (platforms only) | `CHECKOUT.ORDER.COMPLETED` | order | same page (Orders V2, "For use by marketplaces and platforms only") |
| Approval reversed before capture | `CHECKOUT.PAYMENT-APPROVAL.REVERSED` | order | same page (Orders V2) |
| Capture completed | `PAYMENT.CAPTURE.COMPLETED` | `capture` | `PAY:5998-6160` (example at `PAY:6083-6157`) |
| Capture pending | `PAYMENT.CAPTURE.PENDING` | `capture` | event-names page (Payments v2); `PAY:6410-6501` |
| Capture declined (v2) | `PAYMENT.CAPTURE.DECLINED` | `capture` | event-names page (Payments v2); `PAY:6205-6293` |
| Capture denied | `PAYMENT.CAPTURE.DENIED` | `capture` | event-names page (Payments v1 and "Marketplaces and platforms"); `AIT/webhooks.md:21`; https://developer.paypal.com/platforms/checkout/apm/reference/subscribe-to-webhooks |
| Capture refunded | `PAYMENT.CAPTURE.REFUNDED` | `refund` | `PAY:7062-7129` |
| Capture reversed by PayPal | `PAYMENT.CAPTURE.REVERSED` | not stated | event-names page (Payments v2) |
| Refund pending | `PAYMENT.REFUND.PENDING` | not stated | event-names page (Payments v2) |
| Refund failed | `PAYMENT.REFUND.FAILED` | not stated | event-names page (Payments v2) |
| Refund completed | `PAYMENT.REFUND.COMPLETED` | `refund` | `PAY:7264-7265` only; not on the live list |

### Partner app delivery and seller mapping

- "Only events associated with the specific app will be received." Payments made through one REST app do not generate events for webhooks on another app of the same account. Each app can have up to 10 webhook URLs. (https://developer.paypal.com/api/rest/webhooks/, "Initial configuration")
- The multiparty docs tell the partner to create webhooks on its own REST app for `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.*` and related events. (https://developer.paypal.com/platforms/checkout/apm/reference/subscribe-to-webhooks) They also tell the partner to configure webhooks "for all events, such as onboarding, transactions". (https://developer.paypal.com/platforms/get-started/, "Manage back-end operations")
- **Inference:** the partner app is the API caller on our orders, so the partner app receives the events. No page states this in so many words for third-party orders.
- **Mapping an event to the seller:**
  - Capture resources carry `payee.merchant_id`. (`PAY:4817-4830`; live postback sample with `"payee":{"email_address":...,"merchant_id":"QDGTZ7B92B9QT"}` at https://developer.paypal.com/api/rest/webhooks/rest/, "Postback method")
  - Refund resources carry `payer` (`payee_base`, "the merchant for this transaction"). (`PAY:5181-5191`)
  - Order resources carry `purchase_units[].payee`.
  - The safest join key is `custom_id` or the stored order and capture IDs, because our own rows already hold the seller.
- **Event fields** (`event` schema, `WH:1351-1412`):
  - `id`, `create_time`, `resource_type`, `event_version`, `event_type`, `summary`, `resource_version`, `resource`, `links`.
  - In capture events, `resource.id` is the capture ID, `resource.custom_id` is copied from the purchase unit, and `resource.supplementary_data.related_ids.order_id` is the order ID. (`PAY:6091-6143`; `ORD:2582`)
  - The live sample event ID has the form `WH-...`. (https://developer.paypal.com/api/rest/webhooks/rest/)

### Creating a webhook (setup script)

- `POST /v1/notifications/webhooks` with `{"url": "...", "event_types": [{"name": "..."}]}`. Both fields are required, and `url` can be up to 2048 characters. It returns `201` with the webhook `id`. (`WH:73-130`, `WH:1689-1700`; schema check in this run)
- Scope: `https://uri.paypal.com/services/applications/webhooks`. (`WH:124-128`)
- Example from the live multiparty page:

```json
{
  "url": "https://example.com/example_webhook",
  "event_types": [
    { "name": "CHECKOUT.ORDER.APPROVED" },
    { "name": "CHECKOUT.PAYMENT-APPROVAL.REVERSED" },
    { "name": "PAYMENT.CAPTURE.PENDING" },
    { "name": "PAYMENT.CAPTURE.COMPLETED" },
    { "name": "PAYMENT.CAPTURE.DENIED" }
  ]
}
```

(https://developer.paypal.com/platforms/checkout/apm/reference/subscribe-to-webhooks) Other management endpoints: `GET /v1/notifications/webhooks`, `GET|PATCH|DELETE /v1/notifications/webhooks/{id}`, `POST /v1/notifications/webhooks-events/{event_id}/resend`, and `POST /v1/notifications/simulate-event`. (`WH:131-170`, `WH:692`, `WH:741-748`)

## 5. JS SDK v6 (browser)

- **Package:**
  - npm `@paypal/paypal-js`, at version **11.2.0** in the refs clone. The v6 entry point is the subpath export `@paypal/paypal-js/sdk-v6`. (`refs/paypal/paypal-js/packages/paypal-js/package.json:2-3,17-21`)
  - React bindings: `@paypal/react-paypal-js` 10.5.2. (`refs/paypal/paypal-js/packages/react-paypal-js/package.json:2-3`)
- **Loading:**
  - `loadCoreSdkScript({ environment: "sandbox" | "production", debug?, dataNamespace?, dataSdkIntegrationSource? })` returns `Promise<PayPalV6Namespace | null>`. It returns `null` on the server. (`V6/index.d.ts:238-250`; `refs/paypal/paypal-js/packages/paypal-js/src/v6/index.ts:17-71`)
  - It loads `https://www.sandbox.paypal.com/web-sdk/v6/core` or `https://www.paypal.com/web-sdk/v6/core`. (`src/v6/index.ts:43-47`; https://developer.paypal.com/sdk/js/set-up, "Include the SDK script")
  - Do not load v5 and v6 on the same page. (`AIT/js-sdk-v6.md:26`)
- **Creating the instance:**
  - Call `window.paypal.createInstance({...})`. Exactly one of `clientId` or `clientToken` must be set; the types make them mutually exclusive. (`V6/index.d.ts:76-84`)
  - Other options: `components`, `locale`, `pageType`, `partnerAttributionId`, `merchantId?: string | string[]`, `clientMetadataId`, `shopperSessionId`, `testBuyerCountry`. (`V6/index.d.ts:65-74`)
  - `pageType` values: `cart`, `checkout`, `home`, `mini-cart`, `product-details`, `product-listing`, `search-results`. (`V6/index.d.ts:56-63`)
  - The React provider passes `merchantId` and `partnerAttributionId` straight to `createInstance`. (`refs/paypal/paypal-js/packages/react-paypal-js/src/v6/components/PayPalProvider.tsx:295-309`)
- **Client ID vs client token:**
  - The live setup page says: "Most integrations should authenticate with a client ID." Client ID is for standard checkout and one-time payments, and the client ID is safe in front-end code. A client token is "for Fastlane only". (https://developer.paypal.com/sdk/js/set-up, "Authenticate the SDK")
  - AIT agrees, with vaulting and Fastlane as the client-token cases. (`AIT/js-sdk-v6.md:42-67`)
  - **So for Veetlyn buttons, the server provides the partner client ID, the seller merchant ID and the BN code, with no token call:**
    ```js
    createInstance({ clientId: PARTNER_CLIENT_ID, merchantId: SELLER_MERCHANT_ID, partnerAttributionId: BN_CODE, components: ["paypal-payments"], pageType: "checkout" })
    ```
  - AIT says partners "must include `merchantId`". (`AIT/js-sdk-v6.md:83-93`) The live v6 pages do not mention `merchantId` or partners at all.
- **Client token, if ever needed:**
  - `POST /v1/oauth2/token` with Basic auth and form body `grant_type=client_credentials&response_type=client_token`, plus `domains[]=...` in production. The token is in `access_token`, and `expires_in` is returned. (https://developer.paypal.com/sdk/js/set-up, "Option B")
  - AIT adds `intent=sdk_init` (needed for Fastlane identity lookup) and says to omit `domains[]` for sandbox and localhost. (`AIT/js-sdk-v6.md:500-536`)
  - No source documents sending `PayPal-Auth-Assertion` on this token call for multiparty.
- **Eligibility:**
  - `sdkInstance.findEligibleMethods({ amount?, currencyCode?, paymentFlow? })` returns an object with `isEligible("paypal" | "venmo" | "paylater" | "credit" | ...)` and `getDetails(...)`. (`V6/components/find-eligible-methods.d.ts:26-29,176-183`; `V6/index.d.ts:196-198`)
  - Check eligibility before rendering. (https://developer.paypal.com/sdk/js/set-up, "Eligibility check")
- **Session:**
  - `createPayPalOneTimePaymentSession({ onApprove, onCancel?, onComplete?, onError?, onShippingAddressChange?, onShippingOptionsChange?, orderId?, commit?, savePayment?, testBuyerCountry? })`. (`V6/components/paypal-payments.d.ts:84-98,206-208`; `V6/components/base-component.d.ts:42-48`)
  - `onApprove` receives `{ fundingSource, orderId, payerId?, billingToken? }`. (`V6/components/base-component.d.ts:10-15`)
  - `onCancel` receives `{ orderId? }`. (`base-component.d.ts:17-19`)
  - `onError` receives a `PayPalError` with `code`, `name`, `isRecoverable` and `message`. (`base-component.d.ts:25-37`)
  - `onComplete` receives `{ paymentSessionState: "approved" | "canceled" | "error" }`. (`base-component.d.ts:21-23`)
- **Start:**
  - `session.start({ presentationMode }, createOrderPromise)` returns `Promise<void | { redirectURL? }>`. The second argument is `Promise<{ orderId: string }>`. (`V6/components/paypal-payments.d.ts:119-128`)
  - Presentation modes: `auto` (default; tries popup, then modal), `popup`, `modal` (WebView only), `redirect` (needs return/cancel URL), `payment-handler`, `direct-app-switch`. (`base-component.d.ts:50-84`; https://developer.paypal.com/sdk/js/reference, `paymentSession.start`)
  - Pass the invoked promise (`createOrder()`), not the function. The runtime rejects a function. (`AIT/js-sdk-v6.md:156`; live example at https://developer.paypal.com/sdk/js/set-up, "Recommended frontend setup")
  - For redirect mode, use `session.hasReturned()` and then `session.resume()` on page load. (`V6/components/paypal-payments.d.ts:126-127`; https://developer.paypal.com/sdk/js/reference, `paymentSession.hasReturned`)
- **Button element:** `<paypal-button type="pay">` (types `pay`, `checkout`, `buynow`, `subscribe`). Attach a click listener that calls `session.start(...)`. (`V6/components/web-components.d.ts:10-21,151`; `AIT/js-sdk-v6.md:206-222`)
- **CSP needs:** `script-src`, `frame-src`, `connect-src` and `img-src` must allow `https://*.paypal.com`; `script-src` and `img-src` also need `https://*.paypalobjects.com`. (`AIT/js-sdk-v6.md:677-686`)

## 6. Refunds (read-only, for modelling)

- The `PAYMENT.CAPTURE.REFUNDED` event has `resource_type: "refund"` and a `refund` resource. (`PAY:7044-7050`, `PAY:7063-7072`)
- **Refund resource fields:**
  - `id`, `status` (`CANCELLED`, `FAILED`, `PENDING`, `COMPLETED`), `status_details.reason` (`ECHECK`), `amount`, `invoice_id`, `custom_id`, `acquirer_reference_number`, `note_to_payer`, `payer` (the merchant), `links`, `create_time`, `update_time`. (`PAY:5009-5200`, `PAY:4924-4960`)
  - `seller_payable_breakdown` holds `gross_amount`, `paypal_fee`, `net_amount`, `platform_fees[]`, `net_amount_breakdown[]` and `total_refunded_amount`. (`PAY:5075-5180`)
- **Finding the capture ID:** the refund resource has no `supplementary_data` in the spec. The capture ID is in the link with `rel: "up"`, which points to `.../v2/payments/captures/{capture_id}`. (`PAY:7100-7111`; also `PAY:1761-1771`)
- The refund's `custom_id` and `invoice_id` are the values sent on the refund request. They are not necessarily the order's values. (`PAY:1645-1656`)
- The refund endpoint is `POST /v2/payments/captures/{capture_id}/refund`. An empty body means a full refund. It accepts `PayPal-Request-Id`, `Prefer` and `PayPal-Auth-Assertion`. (`PAY:1553-1560`)
- A `PayPal-Request-Id` on a refund can be replayed for up to 45 days. (https://developer.paypal.com/api/rest/requests/ #paypal-request-id)
- Refunds can include `payment_instruction.platform_fees` to return part of the fee. (`RH/snippets/javascript/multiparty-capture.md:3`)

## 7. Sandbox notes

- **Test accounts:**
  - The sandbox creates a default business account (`sb-...@business.example.com`) and a default personal buyer account (`sb-...@personal.example.com`) when you sign up.
  - More accounts are created under Sandbox > Accounts. Each gets a generated email and password.
  - (https://developer.paypal.com/sandbox-testing/accounts)
  - Buyers log in at https://www.sandbox.paypal.com/. (https://developer.paypal.com/sandbox-testing/overview)
- **Negative testing:**
  - Send `PayPal-Mock-Response: {"mock_application_codes": "<ERROR>"}`. It works on Orders v2 create, update, show, authorize and capture, and on Payments v2 capture get, refund and refund get. (https://developer.paypal.com/negative-testing/request-headers)
  - The live multiparty sample shows `INSTRUMENT_DECLINED` and `TRANSACTION_REFUSED` on capture. (https://developer.paypal.com/platforms/checkout/standard/integrate/, "Capture payment")
  - The header is also exposed as `paypalMockResponse` in the server SDK. (`SDK/src/controllers/paymentsController.ts:36-38`)
- **Webhook simulator:** https://developer.paypal.com/dashboard/webhooksSimulator. Mock events have webhook ID `WEBHOOK_ID` and cannot use postback verification. (`AIT/webhooks.md:37`; https://developer.paypal.com/api/rest/webhooks/rest/)
- **Rate limits:**
  - PayPal does not publish a rate-limit policy. It may rate-limit traffic that looks abusive and return 429 `RATE_LIMIT_REACHED`.
  - It advises against polling (use webhooks) and recommends caching OAuth tokens.
  - (https://developer.paypal.com/api/rest/reference/rate-limiting; https://developer.paypal.com/api/rest/responses/)
  - Retry 429 with exponential backoff. (`refs/paypal/AI-Toolkit/skills/paypal-best-practices/SKILL.md:94`)

## Conflicts and gaps

**Conflicts** (resolved by the precedence: live docs, then spec, then library, then ruleshub, then AI-Toolkit):

1. **Is `PayPal-Auth-Assertion` required?**
   - The spec marks it optional on every operation. (`ORD:4137-4156`)
   - The live multiparty guides send it on create, capture and show order. ruleshub calls it required.
   - **Trust the live docs:** send it on create, capture, show order and refund.
2. **Signed or unsigned assertion?**
   - The live docs recommend an unsigned JWT (`alg: none`, empty signature).
   - ruleshub says signed. (`RH/snippets/javascript/multiparty-create-order.md:9`)
   - **Trust the live docs.** The live examples also differ on base64 padding: one uses base64url without padding, the other plain base64. Both appear in official samples.
3. **Disbursement mode on the "Immediate capture" page.** The prose says to set `disbursement_mode` to `DELAYED`, but the samples use `INSTANT`. Immediate capture to the seller means `INSTANT`, which is also the default. (https://developer.paypal.com/platforms/checkout/immediate-capture, step 2; `ORD:4853-4862`)
4. **`PAYMENT.CAPTURE.DECLINED` vs `PAYMENT.CAPTURE.DENIED`.**
   - The live list uses `DECLINED` for Payments v2, and `DENIED` for v1 and for "Marketplaces and platforms".
   - The spec callback uses `DECLINED`. (`PAY:6293`)
   - AIT, ruleshub and the multiparty webhook page use `DENIED`.
   - Neither enum includes a `DENIED` capture status. (`ORD:11888-11895`)
   - **Subscribe to both** and map both to "capture failed".
5. **`PAYMENT.REFUND.COMPLETED`** appears only in the spec (`PAY:7264`), not in the live event list. Treat `PAYMENT.CAPTURE.REFUNDED` as the primary refund event.
6. **v6 auth on the live setup page.** The page says client ID is recommended, but its parameter table lists `clientToken` as required and says the token "expires after 15 minutes", while the sample response shows `expires_in: 32400`. The types allow either credential. **Trust the "Authenticate the SDK" section and the types:** use client ID.
7. **Onboarding webhook names** differ across sources, for example `CUSTOMER.MERCHANT-INTEGRATION.SELLER-ONBOARDING.*` in ruleshub. The live list has `MERCHANT.ONBOARDING.COMPLETED`, `MERCHANT.PARTNER-CONSENT.REVOKED` and `CUSTOMER.MERCHANT-INTEGRATION.*`, without `SELLER-ONBOARDING.STARTED/COMPLETED`. (`RH/snippets/javascript/webhooks.md:136-139`; https://developer.paypal.com/api/rest/webhooks/event-names/)

**Gaps** (not found in any source):

- What happens when `payee.merchant_id` is set but `PayPal-Auth-Assertion` is missing (success, 403, or the partner becomes the merchant). Test in sandbox.
- Whether `GET /v2/payments/captures/{id}` works for a seller's capture with the partner token alone, or needs the assertion. The spec has no assertion parameter. Test in sandbox. The fallback is `GET /v2/checkout/orders/{order_id}` with the assertion.
- An explicit statement that partner-app webhooks receive events for third-party orders. Today this is inferred from "events associated with the specific app" and from the multiparty webhook setup page.
- The `resource_type` string for `CHECKOUT.ORDER.*` events.
- The v6 `merchantId` option for partners appears only in the types and in AIT, not in the live v6 pages.
- Whether `experience_context.user_action` must match the v6 `commit` flag.
- How long `PayPal-Request-Id` is kept: 6 hours for Orders (spec) vs 45 days for refunds (live). Use a new key per logical attempt, and reuse it only for retries within minutes.
- Numeric rate limits are not published.
