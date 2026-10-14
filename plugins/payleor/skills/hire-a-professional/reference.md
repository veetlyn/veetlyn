# Payleor reference

## Who is who

- **Client:** the person hiring, signed in to Payleor with a verified email. The connector acts for this person only.
- **Seller:** a solo freelancer, a team (an agency or studio with members) or an automated AI seller. Sellers publish offerings on their seller page and choose to be listed for AI assistants.
- **Payleor:** handles the request, the quote, the payment flow, the delivery record and the seller's payouts to its members. The seller is the merchant and PayPal moves the money; Payleor is not a party to the deal.
- A member of the seller's team can never be the client of that team's project.

## Offerings

Each offering has a name, a description, a price range, the usual delivery days, how it is fulfilled (by people, automated, or both) and up to five intake questions the seller wants answered. A price range is a guide; the quote sets the price for a specific brief.

## Project statuses

| Status | Meaning | What the client does |
|---|---|---|
| Quoting | The request reached the seller. A quote may be waiting. | Wait for the quote, or press **Accept quote** when one is shown |
| Awaiting deposit | The client accepted the quote. | Press **Pay … with PayPal** to pay the deposit; the work starts once it is paid |
| In progress | The seller is working. A top-up may be due after a change in scope. | Wait for the delivery, or pay the top-up if the card asks |
| Delivered | The seller delivered (a note, a link, a file). | Review it on the project page, then **Accept delivery** or **Request changes** |
| Awaiting balance | The client accepted the delivery. | Pay the balance; the project then completes |
| Completed | Everything is delivered and paid. | Nothing |
| Cancelled | The project was cancelled. | Nothing |

## Payments

- The **deposit** is half the quote, plus the seller's management fee if the seller charges one. The **balance** (the other half) is due after the client accepts the delivery.
- A change in scope (an amendment the seller proposes and the client accepts on the project page) can add a **top-up** payment or reduce the balance.
- Every payment is approved by the client in PayPal's own window on Payleor's pay page.
- A payment can show as processing for a minute while PayPal finishes; checking again later shows the result.
- Refunds go through the seller; the client can reply to Payleor's emails to reach the seller.

## Deliveries and changes

- A delivery has a note and optionally a link or one file. Downloads are on the project page (the card's **Open project page** link), which also handles amendments.
- Requesting changes sends the delivery back to the seller with the client's note and counts as a revision. The seller delivers again.
- Accepting a delivery fixes the final price and opens the balance payment, or completes the project when nothing is left to pay.

## Emails

Payleor emails the client a private link to the project when the request is sent. The link opens the same project page as the card's link. Payleor does not yet email when a quote or a delivery arrives, so check the project with `get_project` when the user asks.

## What the tools return

- Every tool returns a short text for you and a card for the user. The text always ends with the next step.
- `get_project` lists the actions the card offers: `accept_quote`, `pay`, `accept_delivery`, `request_changes`, `open`.
- The accept tools can only be called by the card's buttons. If the user asks you to accept, tell them to press the button in the latest card; if the card is old, call `get_project` to show a fresh one.
