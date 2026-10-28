# Veetlyn reference

## Who is who

- **Client:** the person hiring, signed in to Veetlyn with a verified email. The connector acts for this person only.
- **Seller:** a solo freelancer, a team (an agency or studio with members) or an automated AI seller. Offerings are listed for AI assistants unless the seller turned that off.
- **Freelancers:** a team's members who answer requests. Depending on how the team works, several of them may each quote on one request; the client picks one.
- **Veetlyn:** handles the request, the conversation, the quotes, the payment flow, the delivery record and the seller's payouts to its members. The seller is the merchant and PayPal moves the money; Veetlyn is not a party to the deal.
- A member of the seller's team can never be the client of that team's project.

## Offerings

Each offering has a name, a description, a price range, the usual delivery days and up to five intake questions the seller wants answered. A price range is a guide; a quote sets the price for a specific brief.

## Project statuses

| Status | Meaning | What the client does |
|---|---|---|
| Quoting | The request reached the team. Freelancers may ask questions; one or more quotes may be waiting. | Answer questions, compare quotes, press **Accept quote** on the one they want |
| Declined | The team will not quote it, and said why. | Nothing; search again for someone else |
| Expired | Nobody answered the request in time. | Nothing; search again |
| Awaiting deposit | The client accepted a quote. | Press **Pay … with PayPal** to pay the deposit; the work starts once it is paid |
| In progress | The freelancer is working. A top-up may be due after a change in scope. | Wait for the delivery, or pay the top-up if the card asks |
| Delivered | The freelancer delivered (a note, a link, a file). | Review it on the project page, then **Accept delivery** or **Request changes** |
| Awaiting balance | The client accepted the delivery. | Pay the balance; the project then completes |
| Completed | Everything is delivered and paid. | Nothing |
| Cancelled | The project was cancelled. | Nothing |

## Conversations

- Before a quote is accepted, the freelancers looking at the request can ask the client questions and read the client's replies. Emails, phone numbers and links to messaging, social and freelance sites are hidden on both sides until a quote is accepted; file links show.
- A reply marked team only goes to the team's staff, not to the freelancers.
- Once a quote is accepted, the chosen freelancer and the team see the whole history, and the other freelancers no longer see the request.
- The same conversation shows on the client's project page, in the card and on the team's dashboard.

## Payments

- The **deposit** is half the quote, plus the seller's management fee if the seller charges one. The **balance** (the other half) is due after the client accepts the delivery.
- A change in scope (an amendment the team proposes and the client accepts on the project page) can add a **top-up** payment or reduce the balance.
- Every payment is approved by the client in PayPal's own window on Veetlyn's pay page, which opens on the team's own site.
- A payment can show as processing for a minute while PayPal finishes; checking again later shows the result.
- Refunds go through the seller.

## Deliveries and changes

- A delivery has a note and optionally a link or one file. Downloads are on the project page (the card's **Open project page** link), which also handles amendments.
- Only the seller uploads files. Files the freelancer needs from the client go in the brief or a reply as links.
- Requesting changes sends the delivery back with the client's note and counts as a revision. The freelancer delivers again.
- Accepting a delivery fixes the final price and opens the balance payment, or completes the project when nothing is left to pay.

## Emails

Veetlyn emails the client a private link to the project when the request is sent. It opens the same project page as the card's link, on the team's own site. Veetlyn does not yet email when a question, a quote or a delivery arrives, so check the project with `get_project` when the user asks.

## What the tools return

- Every tool returns a short text for you and a card for the user. The text always ends with the next step.
- `get_project` returns a summary of who responded, each freelancer's quote, the open questions with their ids, and the actions the card offers: `accept_quote`, `pay`, `accept_delivery`, `request_changes`, `reply`, `search`, `open`.
- `reply` answers a question (with its `questionId`) or sends a message; its result says who reads it.
- The accept tools can only be called by the card's buttons. If the user asks you to accept, tell them to press the button in the latest card; if the card is old, call `get_project` to show a fresh one.
