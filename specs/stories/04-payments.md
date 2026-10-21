# Payments (PAY)

The pay page (deposit, top-up, balance), PayPal webhooks and fees in the ledger. Balance payments and completion are in [`05-delivery-and-completion.md`](05-delivery-and-completion.md); store checkout is in [`06-store.md`](06-store.md).

Shared facts for these stories:

- `walk-crew` charges a 10% management fee and keeps a 15% team cut. Its plan (Team) sends Payleor 0.5% of each payment as PayPal's `platform_fees`; a solo seller (Solo plan) sends 1%. The plans and fees are in `packages/core/src/billing/seller-plans.ts` (changed on 2026-10-19 from 1% and 2%).
- Pay the PayPal popup from a browser profile that is not signed in to PayPal as the sandbox seller; PayPal refuses a payment to yourself (`CANNOT_PAY_SELF`).
- The team pages show payment statuses only. Ledger entries, fees and webhook events have no page yet, so those checks are marked "DB check (developer)".

### PAY-01: Client opens the pay page for the deposit

- **Actor:** client · **Surface:** web (client page, pay page) · **Delivered by:** R1a (`17a6499`), R1b (`a46bcf2`) · **Status:** Built (not walked through since the client and pay pages moved to `{seller}` in C)
- **Preconditions:** a `walk-crew` project with a $200 quote in two lines that the client accepted on the client page (see `03-requests-and-quotes.md`).
- **Steps:**
  1. Open the client page `{seller}/c/<token>` (from the client email, or the "Client link:" line on the team's project page `{dash}/walk-crew/projects/<id>`).
  2. In **Payments**, click **Pay with PayPal** on the Deposit card.
- **Expected:**
  - The client page's Deposit card shows the status "Waiting", the lines "Deposit (50% of the quote)" $100.00 and "Management fee (10%)" $20.00, "Total" $120.00, and **Pay with PayPal** linking to `{seller}/pay/<token>`.
  - The pay page shows the team name, the project title, "Deposit", the same lines and "Total" $120.00, the PayPal button, and "Back to the project" linking to the client page.
  - The pay link names the payment only; the amount always comes from the server.
- **Edge cases:** the same page labels a top-up "Top-up" (PAY-11) and a balance "Balance" (DEL-08).

### PAY-02: Client pays the deposit

- **Actor:** client · **Surface:** web (pay page) · **Delivered by:** R1a (`17a6499`), R1b (`a46bcf2`) · **Status:** Built
- **Preconditions:** PAY-01.
- **Steps:**
  1. On the pay page, click the PayPal button.
  2. [human] Log in as the PayPal buyer in the popup and approve.
- **Expected:**
  - While the server captures, the page shows "Confirming your payment…", then "Paid. Thank you." with focus moved to it and no PayPal button.
  - The client page shows the project "In progress" and the Deposit status "Paid", with no pay link.
  - The team's project page shows "In progress" and the Deposit "Paid".
  - [human] In the sandbox seller's PayPal account, the transaction lists two items ("Deposit (50% of the quote)" and "Management fee (10%)") and a "Partner Commission" of $0.60 (0.5%).
  - DB check (developer): the payment is `captured` with `platform_fee_minor` 60; one balanced `payment_captured` transfer (paypal_clearing −12000, team_revenue +2000, client_held +10000); an outbox `payment.captured` event; the project deadline is PayPal's capture time plus the quote's delivery days.
- **Edge cases:** a capture event or approval event arriving later changes nothing (PAY-15).

### PAY-03: A paid link stays paid

- **Actor:** client · **Surface:** web (pay page, client page) · **Delivered by:** R1a (`17a6499`), R1b (`a46bcf2`) · **Status:** Built
- **Preconditions:** PAY-02.
- **Steps:**
  1. Open the same pay link again.
  2. Reload the client page.
- **Expected:**
  - The pay page shows the lines and "Paid. Thank you." with no PayPal button.
  - The client page offers no pay link for the deposit.
  - A direct `payment.payStart` call with the link answers "This payment is already paid." (CONFLICT).
  - DB check (developer): a repeated `payment.payCapture` answers `captured` and adds no ledger transfer.

### PAY-04: Repeated clicks open one PayPal order; starts are rate limited

- **Actor:** client · **Surface:** web (pay page) · **Delivered by:** R1a (`17a6499`), R1b (`a46bcf2`) · **Status:** Built
- **Preconditions:** a pending deposit or top-up on a `walk-crew` project.
- **Steps:**
  1. On the pay page, double-click the PayPal button, then close the popup without paying.
  2. Click the button again and close the popup.
  3. Start the payment more than 10 times within 10 minutes (or have a developer fill the `pay-start:<paymentId>` row in `request_limit`).
- **Expected:**
  - A double click starts one payment, opens one popup and creates one PayPal order.
  - DB check (developer): after step 2 the payment keeps the same `paypal_order_id`; a new PayPal order is created only once the old one is dead (declined or expired).
  - Past the limit (10 starts and 20 captures per payment per 10 minutes), the page shows "Too many attempts. Wait a few minutes and try again." and no popup stays open.

### PAY-05: An invalid pay link

- **Actor:** client · **Surface:** web (pay page) · **Delivered by:** R1b (`a46bcf2`) · **Status:** Built (not walked through since the client and pay pages moved to `{seller}` in C)
- **Preconditions:** none.
- **Steps:**
  1. Open `{seller}/pay/not-a-real-token`, then a real pay link with one character changed.
- **Expected:**
  - Both show "This link is not valid" and "Ask the team to send you the payment link again."
  - Developer check: the `payment.payGet` error answer is `NOT_FOUND` "This link is not valid." with no `stack` field.

### PAY-06: A team without PayPal cannot take the payment

- **Actor:** client · **Surface:** web (pay page) · **Delivered by:** R1b (`a46bcf2`) · **Status:** Built (not walked through)
- **Preconditions:** a project with an accepted quote on a seller that has not connected PayPal (for example `walk-crew-solo`, which has no merchant ID).
- **Steps:**
  1. Open the deposit's pay link from the client page.
- **Expected:**
  - The pay page shows the lines and "This team cannot take PayPal payments yet. Ask them to connect PayPal." with no PayPal button.
  - A direct `payment.payStart` call answers "This team cannot take PayPal payments yet."

### PAY-07: A declined payment lets the client try again

- **Actor:** client · **Surface:** web (pay page, client page) · **Delivered by:** R1a (`17a6499`), R1b (`a46bcf2`) · **Status:** Built (not walked through)
- **Preconditions:** a pending payment; a sandbox funding source PayPal declines (PayPal sandbox negative testing).
- **Steps:**
  1. Click the PayPal button.
  2. [human] Approve with the declined funding source.
  3. Click the button again and [human] approve with a working one.
- **Expected:**
  - A card declined at capture (`INSTRUMENT_DECLINED`) shows "PayPal declined this payment method. Choose another way to pay." and the button stays usable on the same page.
  - A capture PayPal declines shows "PayPal declined this payment. Try again or choose another way to pay."; the payment becomes `failed` and the client page's link reads "Try paying again".
  - The next attempt creates a fresh PayPal order and ends with "Paid. Thank you."

### PAY-08: A capture PayPal is still processing

- **Actor:** client · **Surface:** web (pay page, client page) · **Delivered by:** R1a (`17a6499`), R1b (`a46bcf2`), R1c (`e2fcebf`) · **Status:** Built (not walked through)
- **Preconditions:** a payment whose capture PayPal reports as `PENDING` (hard to produce in the sandbox).
- **Steps:**
  1. Open the pay page and the client page.
- **Expected:**
  - The pay page shows "PayPal is still processing this payment. This page updates on its own." and checks again every 5 seconds.
  - The client page's link reads "See payment status".
  - A new start is refused with "PayPal is still processing this payment. Check back soon."
  - When the webhook reports the capture `COMPLETED`, the pay page turns to "Paid. Thank you." and the project moves on.

### PAY-09: "Your payment may have gone through"

- **Actor:** client · **Surface:** web (pay page) · **Delivered by:** B2 (`eed3537`) · **Status:** Built (not walked through)
- **Preconditions:** a capture call that fails with a PayPal error other than a decline while PayPal's order shows no capture yet. This needs a faulty PayPal answer; router tests cover it.
- **Steps:**
  1. [human] Approve the payment in the popup.
- **Expected:**
  - The page shows "We could not confirm your payment. It may have gone through; check your email before trying again."
  - If the capture went through, the webhook applies it (PAY-10) and the pay page then shows "Paid. Thank you."
- **Edge cases:** known gap (backlog): the message also shows when PayPal's lookup proves no capture happened.

### PAY-10: The webhook captures a payment the page never reported

- **Actor:** client · **Surface:** web (pay page) and PayPal webhooks · **Delivered by:** R1c (`e2fcebf`) · **Status:** Built
- **Preconditions:** a pending deposit or balance on a `walk-crew` project.
- **Steps:**
  1. Open the pay page and click the PayPal button.
  2. [human] Approve as the PayPal buyer, then close the Payleor tab before the page confirms. (If the popup does not open, approve on PayPal's checkout page in its own tab, as in the R2 walkthrough.)
  3. After about a minute, open the client page.
- **Expected:**
  - The payment shows "Paid" and the project has moved on (In progress after a deposit, Completed after a balance).
  - Reopening the pay link shows "Paid. Thank you."
  - DB check (developer): the `CHECKOUT.ORDER.APPROVED` event is `processed / captured` (approvals wait 60 seconds so the page's own capture usually wins); the later approval and capture events end `nothing to do` and `already_applied`; the fees are recorded (PAY-12).

### PAY-11: Client pays an amendment top-up

- **Actor:** client · **Surface:** web (client page, pay page) · **Delivered by:** S4 (`eb3b570`), R1b (`a46bcf2`) · **Status:** Built (not walked through)
- **Preconditions:** a `walk-crew` project in progress with a $200 quote and the $120 deposit paid; the team proposes an amendment adding a $100 line and the client accepts it (see `03-requests-and-quotes.md`).
- **Steps:**
  1. On the client page, click **Pay with PayPal** on the Top-up card.
  2. [human] Approve in the popup.
- **Expected:**
  - Before paying, the Top-up card shows "Top-up (50% of the increase)" $50.00, "Management fee (10%)" $10.00, "Total" $60.00; the pay page is labelled "Top-up".
  - While the top-up is unpaid, accepting a delivery and proposing another amendment are refused with "The top-up for the last amendment is not paid yet."
  - After paying, the pay page shows "Paid. Thank you." and the top-up shows "Paid".
  - The other half of the increase joins the balance: after delivery and acceptance, the balance is $150.00 ($300 + $30 fee − $180 paid).

### PAY-12: Fees are recorded in the ledger

- **Actor:** developer · **Surface:** database · **Delivered by:** R1c (`e2fcebf`), B3 (`0060728`) · **Status:** Built
- **Preconditions:** any captured payment (PAY-02, DEL-08) or store order (STO-07).
- **Steps:**
  1. DB check (developer): read the payment row and the team's ledger transfers.
  2. [human] Compare with the capture's details in the sandbox seller's PayPal account.
- **Expected:**
  - The payment holds PayPal's fee and Payleor's fee from PayPal's `seller_receivable_breakdown` (for example $4.98 and $0.60 on a $120 deposit).
  - One balanced `payment_fees` transfer per payment moves both fees from team revenue to `paypal_fees` and `payleor_fees`.
  - For the team, `−paypal_clearing − paypal_fees − payleor_fees` matches PayPal's net amounts of its captures minus its refunds.
- **Edge cases:** a capture whose receivable is in another currency is flagged: the team's project page shows "Needs review" next to the payment status (B3, not walked through; the sandbox runs in one currency). Known gap (backlog): the Icon pack capture differs from PayPal by $0.14 since its partial refund.

### PAY-13: A solo seller's deposit has no management fee and a 1% fee

- **Actor:** client · **Surface:** web (client page, pay page) · **Delivered by:** R3a (`444c1f4`), R1b (`a46bcf2`) · **Status:** Built
- **Preconditions:** a `walk-crew-solo` project with an accepted quote. The seller must have PayPal connected (PAY-06 otherwise).
- **Steps:**
  1. Open the deposit's pay page and click the PayPal button.
- **Expected:**
  - The deposit has one line, "Deposit (50% of the quote)"; there is no management fee line.
  - DB check (developer): the PayPal order created by the start carries `platform_fees` of 1% of the deposit (a `walk-crew` order carries 0.5%).

### PAY-14: Forged webhook deliveries are refused

- **Actor:** developer · **Surface:** api Worker (`/webhooks/paypal`) · **Delivered by:** R1c (`e2fcebf`) · **Status:** Built
- **Preconditions:** the api Worker's PayPal webhook URL.
- **Steps:**
  1. POST a JSON body to `/webhooks/paypal` with fake PayPal signature headers.
  2. POST it with no signature headers.
  3. POST a body larger than 1 MB.
- **Expected:**
  - Step 1 answers 400 (PayPal's verification fails); step 2 answers 400 `missing_signature_headers`; step 3 answers 413 `body_too_large`.
  - Nothing is stored in `paypal_webhook_event`.
- **Edge cases:** the deployed route still needs a Cloudflare rate limit (backlog, run H).

### PAY-15: Repeated and resent webhook events apply once

- **Actor:** developer · **Surface:** PayPal webhooks, database · **Delivered by:** R1c (`e2fcebf`) · **Status:** Built
- **Preconditions:** captured payments with their webhook events.
- **Steps:**
  1. Resend the sandbox events through PayPal's `POST /v1/notifications/webhooks-events/{id}/resend` (developer, sandbox credentials).
- **Expected:**
  - Capture events end `processed / already_applied`; approvals `processed / nothing to do`; order completions and onboarding events `ignored`.
  - No payment or ledger transfer changes, except fees recorded for a capture that had none yet.

### PAY-16: Stuck webhook events are retried by the maintenance cron

- **Actor:** developer · **Surface:** api Worker cron (every 10 minutes), database · **Delivered by:** B1 (`46cb788`) · **Status:** Built
- **Preconditions:** a `paypal_webhook_event` row left `received` for over 15 minutes, and one for over 3 days (seeded by hand).
- **Steps:**
  1. Wait for the cron, or trigger it by hand in dev.
- **Expected:**
  - The 15-minute-old event is queued again and processed (an unhandled type ends `ignored`, "event type not handled").
  - The 3-day-old event ends `failed` with "Stuck in received for 3 days." and the log line `maintenance.webhooks.failed` names it.
