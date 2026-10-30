# User guide

What you can do with Veetlyn today, in test mode. Everything below runs on the PayPal sandbox in the alpha: a person approves every payment in PayPal, and the product never moves money by itself. Sign up on the dashboard — on staging that is [dash.staging.veetlyn.com](https://dash.staging.veetlyn.com); production opens through the [launch waitlist](https://veetlyn.com/waitlist).

## If you sell services (freelancer or team)

**1. Create your seller.** Sign up, then choose **Just me** or **A team**. A team gets roles (admins, freelancers) and members you invite; a solo seller keeps everything yourself.

**2. Connect PayPal.** Onboarding walks you through connecting a PayPal business account (a [sandbox](https://developer.paypal.com) one in the alpha). Veetlyn's platform fee is taken through PayPal's partner fee on each payment — never by holding your money.

**3. Publish services.** Group your work into departments, then offerings: name, price range, usual duration and the intake questions a client should answer when they request the work. Your seller page at `<your-name>.veetlyn.app` (staging: `<your-name>.staging.veetlyn.app`) shows your bio, services and products; it ships with structured data, a sitemap and an `llms.txt` so search engines and AI assistants can find and describe it.

**4. Answer requests.** A client can request work from your seller page, or their AI assistant can do it for them. A request lands in your dashboard with the client's brief. You have a **48-hour response window** (with a reminder and an expiry) to do one of:

- **Quote** — lines, delivery days, deposit share. The client sees competing quotes side by side and accepts one.
- **Ask the client a question** — the answer comes back to you and shows on the client page.
- **Decline with a reason** — the client sees it, and the request closes.

**5. Deliver and get paid.** After the client accepts your quote they pay the deposit in PayPal (they approve it — you'll see the capture on the project). Upload the delivery (a file up to 100 MB plus a note); the client accepts or requests changes; the balance payment follows, then the project completes and everyone gets the receipt emails.

**6. Pay your members by rule.** On a team, payout rules split each payment between members — fixed shares, a minimum, payday timing, hold days. Depending on your settings, each payout needs a second admin's approval, or an **Auto** rule you configured sends it once the conditions match. Payouts go through PayPal Payouts; a member's page shows what is owed, held or sent.

**7. Sell digital products (optional).** If you also sell goods, add products with a file and a price. Buyers check out as guests on your seller page and download from their order page. Your seller page carries standard policy pages (terms, privacy, refunds) linked from the store.

**When something goes wrong:** a PayPal dispute on a payment holds the project's payouts and shows as a case card in your dashboard with a direct link to the case, until it resolves. Refunds follow your published terms; a late delivery proposes a reduction from the member's share, which an admin confirms.

## If you're hiring (the client)

- **Ask your AI, or use the page.** Open a seller's page and send a request, or ask your assistant (Claude, ChatGPT) — it can search sellers, ask questions and prepare the request. You always see what it sends.
- **Compare and accept.** Every team's quote arrives as a card with its lines and dates. Accepting one records that you accept the seller's terms, and opens the deposit payment.
- **Pay in PayPal, approve in person.** Each payment (deposit, then balance) opens PayPal's checkout; you log in and approve it there. The pay page and your client page update the moment it clears.
- **Follow the work.** Your client page — linked in every email — shows the project's state, the delivery, your conversation with the team, and receipts. Contact details stay masked until a quote is accepted.

## If you're a client using AI

Connect Veetlyn once (see [ai-plugin.md](ai-plugin.md)), then talk to your assistant the way you'd talk to an agent: *"find a studio for a logo refresh, ask them about timelines"* — it searches listed sellers, can ask them questions for you, and prepares the request or the quote comparison. Two hard rules hold everywhere: **an agent prepares, a person pays** — every checkout opens PayPal for your approval — and everything the agent did is logged on the project.

## What the AI cannot do

It never moves money: no capture, no payout, no refund without a person's explicit approval in PayPal or an admin's confirmation in the dashboard. Its permissions come from the seller's own operating model — role, record and business state decide which tools it sees; a stale widget cannot push through a guard. Disputes, refunds above the rulebook's cap, and any action marked "needs a person" in the action registry are outside its reach by construction.

## Limits of the alpha

Payments are sandbox-only; the connector serves the sellers that exist on the environment you connected to; Discord is not a sales channel; ratings, reviews and seller portfolios are on the roadmap, not built. If something breaks, the project's page shows the true state — the dashboard never lies to make a demo look better.
