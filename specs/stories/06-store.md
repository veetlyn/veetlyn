# Store (STO)

Digital products, the store switch, checkout, orders, downloads, and refunds revoking access. Publishing the seller page itself is in [`02-seller-page-and-catalog.md`](02-seller-page-and-catalog.md).

Shared facts for these stories:

- `{seller}` is `walk-crew`'s seller page (`https://walk-crew.payleor.app` today) unless a story names another slug. `walk-crew` is published, has PayPal connected, and its support email is `walk-crew@example.com`.
- Store pages in the admin are under `{dash}/walk-crew` (dashboard), `/products` and `/orders`.
- In dev, file uploads go to a local S3 endpoint, so the browser must allow local network access for the admin host.
- Pay the PayPal popup from a browser profile that is not signed in to PayPal as the sandbox seller.
- Sellers refund store orders in their PayPal account; Payleor has no refund button for orders.

### STO-01: An admin turns on the store

- **Actor:** team admin · **Surface:** web (team dashboard) · **Delivered by:** R4a (`2df314e`), R4b (`60bed6c`) · **Status:** Built
- **Preconditions:** a services team with its store off (a fresh team, or `walk-crew` after STO-14).
- **Steps:**
  1. Open `{dash}/walk-crew`.
  2. In the **Store** card, click **Turn on the store**.
- **Expected:**
  - Before: the nav has no Products or Orders link, and the Store card says "Sell digital downloads, such as presets, templates and icons, from your seller page. Files can be up to 100 MB."
  - After: the nav shows **Products** and **Orders**, and the Store card shows "Open products", "Open orders" and **Turn off the store**.
- **Edge cases:** a member who is not an admin sees the button disabled with "Only an admin can turn on the store." and no Orders link. With the store off, the Products page shows "Sell digital downloads" and its own **Turn on the store**.

### STO-02: An admin adds a digital product

- **Actor:** team admin · **Surface:** web (Products) · **Delivered by:** R4a (`2df314e`) · **Status:** Built
- **Preconditions:** STO-01.
- **Steps:**
  1. Open **Products**, click **Add product**.
  2. Fill Title "Icon pack", a description and Price 19, then **Save product**.
  3. On the product page, click **Publish**.
- **Expected:**
  - Saving lands on the product page, marked "Draft", with **Publish** and a "File buyers download" section saying "No file yet." and "Files can be up to 100 MB."
  - Publishing is refused with "Add the file buyers download before publishing."
- **Edge cases:** a price that is not an amount shows "Enter the price as an amount, for example 150 or 19.99."; an empty title shows "Add a title."; **Save product** stays disabled after the first save, so a double click cannot create two products. Managing products needs an admin ("Only an admin can manage products.").

### STO-03: An admin uploads the file and publishes the product

- **Actor:** team admin · **Surface:** web (product page) · **Delivered by:** R4a (`2df314e`) · **Status:** Built
- **Preconditions:** STO-02.
- **Steps:**
  1. In "File buyers download", choose `icon-pack.zip` and click **Upload**.
  2. Click **Publish**.
  3. Open **Products**.
- **Expected:**
  - The button shows "Uploading… N%", then the section shows `icon-pack.zip`.
  - The product shows "Published" and the button turns to **Unpublish**.
  - The list shows "Icon pack" with "Published · $19.00 · icon-pack.zip".
- **Edge cases:** choosing `tool.exe` shows "This file type is not allowed." and keeps **Upload** disabled (the API refuses it with the same message); uploading another file replaces the old one.

### STO-04: A published product cannot be edited into an unpublishable state

- **Actor:** team admin · **Surface:** web (product page) · **Delivered by:** R4a (`2df314e`) · **Status:** Built (not walked through)
- **Preconditions:** STO-03.
- **Steps:**
  1. On the published product, set Price to 0 and click **Save changes**.
- **Expected:**
  - The save is refused with "Set a price above zero before publishing." and the product keeps its price.
  - A valid edit shows "Saved."

### STO-05: The seller page shows the Store section

- **Actor:** visitor · **Surface:** web (seller page, admin preview) · **Delivered by:** R4a (`2df314e`) · **Status:** Built
- **Preconditions:** STO-03 on a published seller page.
- **Steps:**
  1. Open `{seller}`.
  2. Open the admin preview `{dash}/walk-crew/preview`.
- **Expected:**
  - Below Services, a **Store** section shows a card with "Icon pack", its description, $19.00 and a **Buy** link (labelled "Buy Icon pack") to `{seller}/buy/<productId>`.
  - The preview shows the same section.
- **Edge cases:** an unpublished product, or any product while the store is off (STO-14), is not listed.

### STO-06: The checkout page asks for the buyer's email

- **Actor:** buyer · **Surface:** web (checkout page) · **Delivered by:** R4b (`60bed6c`) · **Status:** Built
- **Preconditions:** STO-05.
- **Steps:**
  1. On `{seller}`, click **Buy** on Icon pack.
  2. Type `not-an-email` in "Your email" and click the PayPal button.
- **Expected:**
  - `{seller}/buy/<productId>` shows "← Walk Crew", "Buy Icon pack", the description, $19.00, "Your email" with "We'll send your download link here.", the PayPal button and "Payments go to Walk Crew through PayPal."
  - The bad email shows "That email address does not look right.", marks the field invalid, focuses it, and no popup opens.
  - The page carries `<meta name="robots" content="noindex, nofollow">`.
- **Edge cases:** a seller without PayPal shows "This seller cannot take payments yet."; a product without its file answers "This product is not available right now." on start.

### STO-07: A buyer pays and lands on the order page

- **Actor:** buyer · **Surface:** web (checkout page, order page) · **Delivered by:** R4b (`60bed6c`) · **Status:** Built
- **Preconditions:** STO-06.
- **Steps:**
  1. Enter a readable email (for example `tester+buyer1@example.com`) and click the PayPal button.
  2. [human] Log in as the PayPal buyer in the popup and approve.
- **Expected:**
  - The page shows "Confirming your payment…", then opens `{seller}/orders/<token>`.
  - The order page shows "Order from Walk Crew", "Icon pack", $19.00, "Paid <date>", **Download** and "5 downloads left · link works until <date 7 days later>".
  - DB check (developer): the order is `paid` with its capture id, PayPal's fee and Payleor's fee (0.5% for `walk-crew`, $0.10 after rounding half up); the PayPal order's `custom_id` is `order:<order id>`; ledger transfers `order_paid` and `order_fees`.
- **Edge cases (not walked through):** a declined capture shows "PayPal declined this payment. Try again or choose another way to pay." (or "PayPal declined this payment method. Choose another way to pay."); a pending capture shows "PayPal is still processing your payment. We'll email your download link as soon as it clears."; an unconfirmed capture shows "We could not confirm your payment. It may have gone through; check your email before trying again." (B2, `eed3537`). Checkout starts and captures are limited per IP and per order ("Too many attempts. Wait a few minutes and try again.").

### STO-08: The buyer downloads the file

- **Actor:** buyer · **Surface:** web (order page) · **Delivered by:** R4b (`60bed6c`) · **Status:** Built
- **Preconditions:** STO-07.
- **Steps:**
  1. Click **Download**.
  2. Compare the SHA-256 of the downloaded file with the uploaded `icon-pack.zip`.
- **Expected:**
  - The button shows "Preparing download…", then the browser downloads the file under its name; the bytes are identical.
  - The page now shows "4 downloads left".
- **Edge cases:** the download serves the product's current file, so a replaced file reaches past buyers; a missing file answers "This file is not available. Contact the seller." without spending a download.

### STO-09: The buyer gets the download email

- **Actor:** buyer · **Surface:** email · **Delivered by:** R4b (`60bed6c`) · **Status:** Built
- **Preconditions:** STO-07.
- **Steps:**
  1. Open the buyer's inbox (AgentMail).
  2. Open the email's **Download** link.
- **Expected:**
  - The email comes from "Walk Crew via Payleor" `<stores@payleor.com>`, reply-to `walk-crew@example.com`, subject "Your download: Icon pack".
  - It says "Thanks for your purchase from Walk Crew. Download Icon pack from your order page:" and "The link works for 7 days and 5 downloads. After that, open it and ask for a new link; it comes to this address."
  - The link opens `{seller}/orders/<token>` with its own token and 5 downloads left.
- **Edge cases:** known gap (backlog): if this email fails while the webhook applies the capture, a buyer who closed the checkout has no link.

### STO-10: A used-up link offers a new one by email

- **Actor:** buyer · **Surface:** web (order page), email · **Delivered by:** R4b (`60bed6c`) · **Status:** Built
- **Preconditions:** STO-09.
- **Steps:**
  1. Download from the email's link until no downloads are left (5 in all).
  2. Reload the order page and click **Email me a new link**.
  3. Open the new email's link.
- **Expected:**
  - The page shows "This link has no downloads left. Ask for a new one and we'll email it to you." and no **Download** button.
  - The button shows "Sending…", then "We sent a new link to t•@example.com." (first letter and domain of the order's email).
  - A second "Your download: Icon pack" email arrives; its link shows 5 downloads left.
  - The new link goes only to the order's email, never to the page.
- **Edge cases (not walked through):** a fourth new link within an hour is refused with "Too many new links for this order. Try again in an hour."

### STO-11: An expired link offers a new one

- **Actor:** buyer · **Surface:** web (order page) · **Delivered by:** R4b (`60bed6c`) · **Status:** Built (not walked through)
- **Preconditions:** an order link older than 7 days (or a developer sets the grant's `expires_at` in the past).
- **Steps:**
  1. Open the link.
- **Expected:**
  - The page shows "This link has expired. Ask for a new one and we'll email it to you." and **Email me a new link**, with no **Download** button.
  - A direct `order.download` call answers "This link has expired. Ask for a new one."

### STO-12: The admin lists the orders

- **Actor:** team admin · **Surface:** web (Orders) · **Delivered by:** R4b (`60bed6c`), B3 (`0060728`) · **Status:** Built
- **Preconditions:** STO-07.
- **Steps:**
  1. On `{dash}/walk-crew`, click **Orders** (or "Open orders").
- **Expected:**
  - `{dash}/walk-crew/orders` lists "Icon pack", the buyer's email, $19.00 and "Paid <date>"; refunded orders show "Refunded <date>".
  - With no orders, the page says "No orders yet. They show up here once a buyer pays."
- **Edge cases:** only admins see the Orders links, and the API answers others with "Only an admin can see orders."; an order whose PayPal receivable is in another currency shows "Needs review" (B3, not walked through).

### STO-13: A refund in PayPal revokes the download

- **Actor:** PayPal seller (team) · **Surface:** PayPal, web (order page, Orders) · **Delivered by:** R4b (`60bed6c`), B3 (`0060728`) · **Status:** Built
- **Preconditions:** a paid order (STO-07).
- **Steps:**
  1. [human] Refund part of the capture (for example $5.00) from the sandbox seller's PayPal account, or have a developer call PayPal's capture refund API with the seller's auth assertion.
  2. After about a minute, reload the order page and the admin Orders page.
- **Expected:**
  - The order page says "This order was refunded, so the download is no longer available." with no buttons; every link of the order (page and emails) stops working.
  - The admin list shows "Refunded <date>".
  - DB check (developer): the `PAYMENT.CAPTURE.REFUNDED` event is `processed / refunded`; the order is `refunded` and all its grants are revoked; transfers `order_refunded:refund:<refund id>` (gross) and `refund_fees:<refund id>` (the PayPal and Payleor fees the refund returned) post once, even when the event is resent.
- **Edge cases:** any refund, partial or full, or a chargeback refunds the order. A capture refunded before Payleor applied it is recorded as paid then refunded, with no download link or email (B3, not walked through).

### STO-14: Turning the store off hides the products

- **Actor:** team admin · **Surface:** web (team dashboard, seller page, checkout page) · **Delivered by:** R4b (`60bed6c`) · **Status:** Built
- **Preconditions:** STO-05.
- **Steps:**
  1. On `{dash}/walk-crew`, click **Turn off the store** and accept the browser's confirmation.
  2. Open `{seller}` and `{seller}/buy/<productId>`.
  3. Turn the store back on (STO-01).
- **Expected:**
  - The confirmation reads "Turn off the store? Your products leave your seller page and buyers can't check out until you turn it back on."
  - With the store off, the seller page has no Store section, the buy page answers 404, and a `checkout.start` call answers "This product is not for sale."; published products no longer count toward publishing the seller page.
  - The Products and Orders links leave the nav.
  - Turning it back on restores the section, the buy page and checkout.
- **Edge cases:** the admin product pages stay reachable by URL while the store is off.

### STO-15: Order links work only on their own store

- **Actor:** buyer · **Surface:** web (order page) · **Delivered by:** B2 (`eed3537`) · **Status:** Built
- **Preconditions:** an order link of `walk-crew` (STO-07).
- **Steps:**
  1. Open the link's path on another published seller's host (`https://<other-slug>.payleor.app/orders/<token>`).
  2. Open `{seller}/orders/not-a-real-token-xxxxxxxxxx`.
  3. View the source of a valid order page.
- **Expected:**
  - Step 1: "This link is not valid. Check the link in your email." (a draft seller's host answers 404 first).
  - Step 2: the same message, with no error toast on top.
  - The order page carries `<meta name="robots" content="noindex, nofollow">`.

### STO-16: A checkout the browser never reported is captured by the webhook

- **Actor:** buyer · **Surface:** web (checkout page), PayPal webhooks, email · **Delivered by:** R4b (`60bed6c`) · **Status:** Built (not walked through)
- **Preconditions:** STO-06.
- **Steps:**
  1. Enter an email and click the PayPal button.
  2. [human] Approve in the popup, then close the checkout tab before it confirms.
- **Expected:**
  - About a minute later the order is paid by the approval webhook, and the buyer email (STO-09) arrives with the order link; there is no other way to reach the order page.
  - DB check (developer): `CHECKOUT.ORDER.APPROVED` is `processed`; the capture is applied once, whichever path reports it first.

### STO-17: Abandoned checkouts are swept

- **Actor:** developer · **Surface:** api Worker cron, database · **Delivered by:** B2 (`eed3537`) · **Status:** Built
- **Preconditions:** pending orders with no capture, created 5 days and 3 days ago (seeded by hand). Each Buy click creates a pending order.
- **Steps:**
  1. Wait for the 10-minute maintenance cron.
- **Expected:**
  - The 5-day-old order is deleted (log `maintenance.orders`); the 3-day-old one stays. Pending orders older than 4 days with no capture are deleted, 500 per run.
