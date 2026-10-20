# Delivery and completion (DEL)

Deliveries (note, link, file), changes requested, acceptance, the balance, completion, and refunds to the client. The pay page itself is in [`04-payments.md`](04-payments.md).

Shared facts for these stories:

- `walk-crew` charges a 10% management fee and keeps a 15% team cut. Walk Through is the team admin and the assigned member, so the deliveries below are made from Walk Through's admin session.
- The team's project page is `{dash}/walk-crew/projects/<id>`; the client page is `{seller}/c/<token>` (link on the team's project page, "Client link:").
- In dev, file uploads and downloads go to a local S3 endpoint, so the browser must allow local network access for the admin and site hosts. On the deployed hosts the `Files` bucket's CORS rule has not been checked yet (backlog, run H).
- Deadline penalties and cases are not built, so the final price is the current quote.

### DEL-01: The team delivers with a note and a link

- **Actor:** freelancer (the assigned member) or team admin · **Surface:** web (team project page, client page) · **Delivered by:** R2 (`722e1e3`) · **Status:** Built
- **Preconditions:** a `walk-crew` project in progress with its deposit paid (PAY-02).
- **Steps:**
  1. On the team's project page, under **Deliveries > Deliver**, type a note in "Note for the client" and an https link in "Link".
  2. Click **Submit delivery**.
  3. Open the client page.
- **Expected:**
  - The team page shows "Delivered", a card "Delivered <date and time>" marked "Waiting for the client" with the note and the link, and "Waiting for the client to accept the delivery or ask for changes." The Deliver form is gone.
  - The client page shows a **Delivery** section with the card marked "Waiting for your answer", the note, the link, **Accept delivery** and **Request changes**.
  - DB check (developer): an outbox `delivery.submitted` event.
- **Edge cases:** **Submit delivery** stays disabled on an empty form; once something is typed, an http link shows "Use an https link." and an over-long note "The note is too long." Only the assigned member or a manager or admin can deliver ("Only the assigned freelancer or a manager can deliver."), and only while the project is In progress.

### DEL-02: The team delivers a file

- **Actor:** freelancer or team admin · **Surface:** web (team project page) · **Delivered by:** R2b (`2aac26f`) · **Status:** Built
- **Preconditions:** a `walk-crew` project in progress.
- **Steps:**
  1. In the Deliver form, pick a small PDF under "File (optional)" and add a note.
  2. Click **Submit delivery**.
  3. After a change request (DEL-05), deliver again with a file of about 60 MB (for example a generated `.zip`).
- **Expected:**
  - After picking, the form shows the file name and size with **Remove file**.
  - During the upload the form shows "Uploading… N%" and a progress bar; the large file completes in seconds.
  - The delivery card on the team page and on the client page shows a button "Download <file name> (<size>)", for example "Download Landing brief.pdf (193 B)".
  - DB check (developer): a `file_upload` row attached to the delivery.
- **Edge cases:** an upload that is never attached to a delivery is deleted by the maintenance cron after a day (B1, `46cb788`; developer check). Uploads are limited to 20 per member per 10 minutes ("Too many uploads. Wait a few minutes and try again.").

### DEL-03: The delivery form refuses disallowed files

- **Actor:** freelancer or team admin · **Surface:** web (team project page) · **Delivered by:** R2b (`2aac26f`) · **Status:** Built
- **Preconditions:** a `walk-crew` project in progress.
- **Steps:**
  1. Pick a file named `tool.exe`.
  2. Pick a file larger than 100 MB (a sparse local file; it is not uploaded).
- **Expected:**
  - The `.exe` shows "This file type is not allowed."
  - The large file shows its name and size (for example "too-big.zip (101 MB)") and "Files can be up to 100 MB."
  - **Submit delivery** stays disabled for both. The file picker offers only the allowed types.
- **Edge cases:** an empty file shows "The file is empty."

### DEL-04: The client downloads the delivered file

- **Actor:** client · **Surface:** web (client page) · **Delivered by:** R2b (`2aac26f`) · **Status:** Built
- **Preconditions:** DEL-02.
- **Steps:**
  1. On the client page, click "Download <file name> (<size>)".
  2. Compare the SHA-256 of the downloaded file with the original.
- **Expected:**
  - The button shows "Preparing download…", then the browser saves the file under its original name; the bytes are identical (also for the 60 MB file).
  - The same button on the team page downloads it too.
  - Developer check: the signed download URL is refused (403) after 5 minutes (`ExpiredRequest`) or when its key or file name is changed.

### DEL-05: The client requests changes

- **Actor:** client · **Surface:** web (client page, team project page) · **Delivered by:** R2 (`722e1e3`) · **Status:** Built
- **Preconditions:** DEL-01 (a delivery waiting for the client).
- **Steps:**
  1. On the client page, click **Request changes**.
  2. Under "What should change?", type a note (for example "Go with concept 2, but use the darker blue.") and click **Send request**.
  3. On the team page, deliver again.
- **Expected:**
  - **Send request** is disabled while the note is empty.
  - The client page shows the delivery "Changes requested" with "Your request" and the note, and the project "In progress".
  - The team page shows "In progress", the card "Changes requested" with "The client asked for changes" and the note, and the Deliver form again.
  - The new delivery appears first on both pages, with **Accept delivery** and **Request changes** on the client page.
  - DB check (developer): the project's `revisions` goes up by one per request (no page shows the count); an outbox `delivery.changes_requested` event.
- **Edge cases:** **Cancel** closes the form without sending; a note over 5,000 characters shows "The note is too long."; a blank note is refused with "Say what should change."

### DEL-06: Project pages update without a reload

- **Actor:** team admin and client · **Surface:** web (team project page, client page) · **Delivered by:** B1 (`46cb788`) · **Status:** Built
- **Preconditions:** a delivered `walk-crew` project; the team page and the client page open in two tabs.
- **Steps:**
  1. In the client tab, request changes (DEL-05). Watch the team tab.
  2. In the team tab, deliver again. Watch the client tab.
- **Expected:**
  - Within 15 seconds and without a reload, the team page shows "In progress" and the client's request.
  - Within 15 seconds, the client page shows the new delivery with **Accept delivery** and **Request changes**.
- **Edge cases:** each page polls only while it waits on the other side, and stops after an invalid link.

### DEL-07: The client accepts the delivery and sees the balance

- **Actor:** client · **Surface:** web (client page, team project page) · **Delivered by:** R2 (`722e1e3`) · **Status:** Built
- **Preconditions:** a delivered `walk-crew` project with a $200 quote and the $120 deposit paid.
- **Steps:**
  1. On the client page, click **Accept delivery**.
- **Expected:**
  - The client page shows "Awaiting balance · Final price $200.00", the delivery "Accepted", and a Balance card "Waiting" with the line "Balance" $100.00, "Total" $100.00 and **Pay with PayPal** (the management fee was paid with the deposit).
  - The team page shows "Awaiting balance" with "Final price $200.00", the Balance "Waiting" and "Waiting for the client to pay."
  - DB check (developer): outbox `delivery.accepted` and `payment.created` events.
- **Edge cases (not walked through):** a pending amendment blocks acceptance ("An amendment is waiting for the client's answer."), and so does an unpaid top-up ("The top-up for the last amendment is not paid yet."); answering a delivery twice gives "This delivery is not waiting for an answer."

### DEL-08: The client pays the balance and the project completes

- **Actor:** client · **Surface:** web (client page, pay page, team project page, member Payouts page) · **Delivered by:** R2 (`722e1e3`), R1c (`e2fcebf`) · **Status:** Built
- **Preconditions:** DEL-07.
- **Steps:**
  1. On the client page, click **Pay with PayPal** on the Balance card. The pay page is labelled "Balance".
  2. [human] Approve as the PayPal buyer in the popup. If the popup does not open, approve on PayPal's checkout page in its own tab; the approval webhook captures it.
- **Expected:**
  - The pay page shows "Paid. Thank you."
  - The client page shows "Completed · Final price $200.00" and "This project is complete. Thank you."
  - The team page shows "Completed" and the Balance "Paid".
  - Walk Through's Payouts page `{dash}/me/payouts` shows walk-crew's "Available" earnings up by $170.00 ($200 minus the 15% team cut). If the team's payout rules create a payout per completed project, the amount moves to "In progress" once that payout is created (see `07-payouts.md`).
  - DB check (developer): `client_held` for the project is 0; a `completion` transfer moves 17000 to `owed:<Walk Through>:available`; team revenue up by the $30.00 team cut less the balance's fees; transfers `payment_captured`, `completion` and `payment_fees`; outbox `payment.captured` and `project.completed`.
- **Edge cases:** a solo seller's completion books the whole price as revenue and owes no earnings. Automatic project payouts after completion are in `07-payouts.md`.

### DEL-09: Accepting with nothing left to pay completes at once and shows a refund owed

- **Actor:** client · **Surface:** web (client page, team project page) · **Delivered by:** R2 (`722e1e3`), B3 (`0060728`) · **Status:** Built
- **Preconditions:** a `walk-crew` project in progress with a $300 quote in one line and its $180 deposit paid ($150 + $30 fee); the team proposes an amendment that replaces the $300 line with a $100 line, the client accepts it (see `03-requests-and-quotes.md`), and the team delivers.
- **Steps:**
  1. On the client page, click **Accept delivery**.
- **Expected:**
  - No balance payment is created. The client page shows "Completed · Final price $100.00" and "Refund of $70.00: on its way".
  - The team page shows a **Refund to the client** section with "The client overpaid by $70.00." and, for admins, **Refund $70.00 to the client**.
  - DB check (developer): a `refund_requested` transfer and a `project_refund` row `requested` for $70.00.

### DEL-10: An admin refunds the overpaid client through PayPal

- **Actor:** team admin · **Surface:** web (team project page, client page) · **Delivered by:** B3 (`0060728`) · **Status:** Built
- **Preconditions:** DEL-09.
- **Steps:**
  1. On the team page, click **Refund $70.00 to the client**.
  2. Read the dialog: "Refund $70.00 to <client>?" and "PayPal sends it from your PayPal account. This cannot be undone."
  3. [human] Click **Refund $70.00** (it sends sandbox money; a person confirms money movements).
- **Expected:**
  - The team page shows "Refunded $70.00 on <date>" and the part "Deposit · $70.00" marked "Sent".
  - The client page shows "Refunded $70.00 on <date>".
  - On both pages the Deposit shows "Partly refunded $70.00".
  - [human] The sandbox seller's PayPal account lists the $70.00 refund on the deposit capture.
  - DB check (developer): `refund_confirmed` and `refund_fees` transfers; `client_refunds` and the project's `client_held` are 0; the `PAYMENT.CAPTURE.REFUNDED` webhook that follows posts nothing new.
- **Edge cases (not walked through):** managers and freelancers see no button, and the API answers "Only an admin can refund the client."; a refund larger than one capture is split across captures, newest first; a part PayPal refuses shows "PayPal did not refund the client: …" with **Try again**; an unconfirmed part shows "We could not confirm the refund with PayPal. Try again; the client will not be refunded twice."; repeated clicks get "This refund is being sent." or "This refund was already sent."

### DEL-11: A refund made in PayPal shows on the project

- **Actor:** PayPal seller (team) · **Surface:** PayPal, web (team project page, client page) · **Delivered by:** B3 (`0060728`) · **Status:** Built
- **Preconditions:** a `walk-crew` project with a captured payment.
- **Steps:**
  1. [human] Refund part of the capture (for example $3.00) from the sandbox seller's PayPal account, or have a developer call PayPal's capture refund API with the seller's auth assertion.
  2. After about a minute, open the team page and the client page.
- **Expected:**
  - The payment shows "Partly refunded $3.00" on both pages ("Refunded" once nothing is left with the team).
  - A fully refunded payment's pay link shows "This payment was refunded."
  - DB check (developer): a `payment_refunded:refund:<refund id>` transfer (from the project's `client_held` first while the project is open, from team revenue once it is completed) and a `refund_fees` transfer; resending the webhook posts nothing.
- **Edge cases:** the walkthrough refunded a completed project's payment; the open-project path is covered by tests only. Known gaps (backlog): a refund made before Payleor applied the capture is parked, not recorded.
