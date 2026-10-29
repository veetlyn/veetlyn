# Pricing for freelancers, teams and shops

- **Status:** approved as proposed on 2026-10-07; services plans **replaced on 2026-10-19** by the pricing page in [`2026-10-19-pricing-draft.html`](../archive/platform/2026-10-19-pricing-draft.html): three plans (Solo $19, 1%; Team $59, 0.5%, up to 10 members; Agency $199, 0.25%, up to 50), yearly at two months free, and a one-time 5% network fee on the first project with a client found through an AI agent (shown on the page, not yet charged). The shop plans below are unchanged
- **Asked for in:** the sellers design review ([`2026-10-07-sellers-minimal-flow-design.md`](../archive/platform/2026-10-07-sellers-minimal-flow-design.md) §14): every plan has a subscription and a per-payment fee, with plans scaled separately for freelancers and for teams
- **Based on:** [`2026-10-07-pricing-research.md`](../archive/platform/2026-10-07-pricing-research.md) (vendor pages, accessed 2026-10-07). "Research A§1" means Part A, section 1
- **Replaces:** the services spec's fee of 0.5% + 0.10 per client payment and its bundles (services spec goal 7 and §13). Shop plans stay as in platform spec §6.7

## 1. The plans

Prices are in USD and exclude tax. PayPal's own processing fees are separate and charged by PayPal. Every plan starts with a 14-day free trial.

### 1.1 Freelancers ("Just me")

| Plan | Monthly | Yearly, per month | Fee per payment | Includes |
|---|---|---|---|---|
| Solo | $9 | $7 | 2% | Seller page with services, quote requests, client pages and digital products; 2 GB of files; 20 AI drafts a month; a small "Sold with Veetlyn" badge |
| Pro | $24 | $18 | 1% | Everything in Solo, plus a custom domain, no badge, 20 GB, 100 AI drafts |
| Premium | $59 | $45 | 0.5% | Everything in Pro, plus 100 GB, 300 AI drafts, priority support |

### 1.2 Teams ("A team")

| Plan | Monthly | Yearly, per month | Fee per payment | Members | Includes |
|---|---|---|---|---|---|
| Team | $39 | $29 | 1% | Up to 5 | Everything in the freelancer Pro plan, plus members, roles and titles, the team cut and management fee, payouts by approval, by rule or automatically; 50 GB; 200 AI drafts |
| Studio | $99 | $75 | 0.5% | Up to 15 | Everything in Team, plus the payout agent, the public API and outgoing webhooks; 200 GB; 500 AI drafts |
| Agency | $249 | $189 | 0.25% | Up to 50 | Everything in Studio, plus 500 GB, 1,500 AI drafts, priority support. More than 50 members on request |

### 1.3 Shops (unchanged, platform spec §6.7)

| Plan | Monthly | Yearly, per month | Fee per order |
|---|---|---|---|
| Starter | $12 | $9 | 2% |
| Grow | $39 | $29 | 1% |
| Scale | $129 | $99 | 0.5% |

### 1.4 In every seller plan

The Discord bot, ChatGPT and Claude hiring when it ships (sellers design §12), and no limit on services, products, projects or clients. Physical goods need a shop plan.

Custom domains, the public API and outgoing webhooks come after the minimal flow. The plans list them now so that prices do not change when they ship.

## 2. Why this shape

- **One rule everywhere:** each plan is a price plus a percentage, and the percentage falls as the price rises. Payhip and Sellix use this rule (research B§1, A§4), and Veetlyn's shop plans already follow Shopify's version of it (platform spec §6.7).
- **Freelancers scale with revenue.** Moving up pays off at about $1,500 a month in payments (Solo to Pro) and $7,000 a month (Pro to Premium).
- **Teams scale with members, then revenue.** A team pays a higher base and a lower percentage than a freelancer, because the client payment is shared with the members. Member caps are the main reason to move up. On fees alone, Team to Studio pays off at $12,000 a month.
- **No fixed fee per payment.** PayPal already takes $0.49 per payment, which costs a $5 download 13% (research B§2). A fixed Veetlyn fee would make small downloads worse.
- **A low entry price instead of a free plan.** As asked, every plan has a subscription. The trial and the $9 Solo plan play the role of a free plan. If sign-ups stall, the usual next step is a free plan at about 5%, as Payhip, Ko-fi and Sellix offer (research B§1, A§4).
- **Costs are not the constraint.** An active seller costs Veetlyn about $0.20 to $1.40 a month in infrastructure, email and AI (research B§4). The AI draft limits exist to stop abuse, not to cover costs.

## 3. What sellers pay, compared

Platform charges only. Payment processing is extra everywhere. On Veetlyn it is PayPal's rate, 3.49% + $0.49 per payment for US sellers (research B§2).

**A freelancer with $3,000 a month in payments**

| Option | Per month |
|---|---|
| Veetlyn Pro | $24 + 1% = $54 |
| Veetlyn Solo | $9 + 2% = $69 |
| HoneyBook Starter | $36 (research A§1) |
| Bonsai Essentials, paid through PayPal in the US | $25 + 1% = $55 (research A§1) |
| Payhip Plus, digital products | $29 + 2% = $89 (research B§1) |
| Upwork, 0–15% service fee | up to $450 (research A§2) |
| Fiverr, 20% | $600 (research A§2) |

**A team of 5 with $10,000 a month in client payments**

| Option | Per month |
|---|---|
| Veetlyn Team | $39 + 1% = $139, payouts included (PayPal charges the team $0.25 per US payout, research B§2) |
| HoneyBook Premium | $129, up to 10 members (research A§1) |
| Deel, contractor payments only | 5 × $49 = $245 (research A§3) |
| An agency on Upwork at 10% | $1,000 (research A§2) |

Veetlyn sits between flat-price client tools and marketplaces that take 10–20%. Paying members is the part that contractor tools sell separately, per person (research A§3).

**What it could earn (an illustration, not a forecast).** Say 100 paying sellers: 50 on Solo at $1,000 a month in payments, 30 on Pro at $3,000, 15 on Team at $8,000 and 5 on Studio at $25,000. Veetlyn would earn about $6,000 a month, before PayPal's fees on the subscriptions and before running costs of about $55 to $140 a month (research B§4).

## 4. Rules

- **The fee:** the plan's percentage of each payment, rounded to the cent, taken through PayPal's `platform_fees` in the payment's currency. It applies to deposits, top-ups and balances, and to store orders. The rate is the one of the plan that is active when PayPal captures the payment.
- **Trial:** 14 days from the seller's creation, with the entry plan of the seller's audience (Solo, Team or Starter).
- **After a trial or a failed payment** (7-day grace period, as for stores): the seller page goes back to draft and takes no new quote requests or orders. Open projects can still be paid and delivered, and download links already sent keep working, so clients and buyers are never stuck.
- **Changing plans:** an upgrade takes effect at once, with the new fee. A downgrade takes effect at the end of the billing period. Switching from "Just me" to "A team" moves the seller to team plans.
- **Refunds:** Veetlyn keeps its fee, as PayPal keeps its own. The refund happens in the seller's PayPal account, and returning a platform fee needs PayPal to enable it (research B§2). Revisit this when the refund button exists.
- **Billing unit:** the team, as for stores. A workspace with a services team and a store pays two plans.

## 5. Billing changes to the platform spec (§6.7 there)

- **A separate PayPal account for billing.** PayPal's multiparty docs say the partner account that receives platform fees cannot hold a PayPal balance and should not also sell (research B§2). Veetlyn's subscriptions therefore need a second Veetlyn business account with its own REST app, used only for PayPal Subscriptions.
- **18 PayPal plans** instead of 6: three audiences, three tiers and two intervals, created by the setup script.
- Yearly billing is cheaper for Veetlyn too: PayPal's fixed fee is paid once a year instead of twelve times.

## 6. In the code and the runs

- `packages/core/src/billing/plans.ts` gains the six seller plans next to the shop plans. Each has its prices, `feeBps`, `members`, `storageGb`, `aiDraftsPerMonth` and the flags `customDomain`, `hideBadge`, `payoutAgent`, `publicApi` and `prioritySupport`. The page and the billing code read the same data, as they do for shops.
- Until billing ships, `planFor` returns the entry plan of each audience: Starter for stores, Team for services teams, and Solo once run 3 adds the "Just me" setting.
- **Run 1:** the payment module reads the fee from `planFor`.
- **Run 3:** "Just me" sellers get Solo. The site shows offers by audience: "For freelancers and teams", with a "Just me / A team" switch and these plans, then "For shops".
- **Runs 3–6:** each run checks the limits it touches: members (runs 3 and 5), storage (run 4), AI drafts (run 6), the badge (run 3).
- **New run 8, billing:** PayPal Subscriptions on the billing account, the trial, the Billing page, and plan changes. This is optional before the hackathon. Until it ships, the prices are shown and the fees apply, but no subscription is charged.

## 7. Check before going live

- PayPal pays platform fees once a day into a bank account linked to the partner account (research B§2). PayPal lists Senegal as "send, receive, and withdraw" (https://developer.paypal.com/payouts/supported-features), with withdrawals to a local bank or wallet through a third-party provider at 2% + $1.50 (https://www.paypal.com/sn/digital-wallet/paypal-consumer-fees). Ask PayPal whether a partner account registered in Senegal can receive platform fees, or whether the company needs an account in another country.
- PayPal must turn on "Platform Fee" for the live REST app, and every seller grants `PARTNER_FEE` when connecting (research B§2).
- Sellers who mostly sell downloads under about $27 can apply to PayPal for micropayments pricing (4.99% + $0.09). It is set per PayPal account, so it also applies to large service payments, where it costs more. The help pages should explain this trade-off.
