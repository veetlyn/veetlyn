# Story book

Every finished feature of Veetlyn as a user story with steps and expected results that a person or a browser agent (Claude in Chrome, Playwright) can check against the deployed sandbox app. A story is a claim: "this works, like this". Walkthroughs run stories; a failed check becomes a backlog row.

## Hosts

| Placeholder | Production (after a merge) | Staging (a branch before its merge) |
|---|---|---|
| `{site}` | `https://veetlyn.com` | `https://staging.veetlyn.com` |
| `{dash}` | `https://dash.veetlyn.com` | `https://dash.staging.veetlyn.com` |
| `{seller}` | `https://<slug>.veetlyn.app` | `https://<slug>.staging.veetlyn.app` |
| `{api}` | `https://api.veetlyn.com` | `https://api.staging.veetlyn.com` |

Everything runs in the PayPal sandbox. No real money moves.

## Accounts (by role)

Stories name roles, never passwords. Where to find each login: `../PROGRESS.md` (Environment, "Sandbox walkthrough accounts"); PayPal sandbox logins are the `SANDBOX_*` values in `packages/infra/.env` (never printed or committed).

| Role | Who |
|---|---|
| Team admin | "Walk Through", owner of team `walk-crew` (`tester@example.com`) |
| Second and third admins | `tester+admin2@example.com`, `tester+admin3@example.com` (admins of `walk-crew`) |
| Freelancer | A `walk-crew` member with the freelancer role (Walk Through also acts as the assigned member and payee) |
| Solo seller | `walk-b2-solo` (draft solo seller; `walk-crew-solo` became a team in R3a), or a new one from ACC-08 |
| Client | Any email the tester reads (an AgentMail plus address such as `tester+client1@example.com`) |
| PayPal buyer | Sandbox buyer 2 (`SANDBOX_BUYER_2_*`) pays project and store payments |
| PayPal seller | Sandbox seller 3 (`SANDBOX_SELLER_3_*`), the merchant behind `walk-crew` |
| Member payout destination | Sandbox buyer 1 (`SANDBOX_BUYER_1_*`) |

Emails to AgentMail addresses are read in the AgentMail inbox (`AGENT_MAIL_*` in `apps/server/.env`).

## Story format

Each area file holds stories in this shape:

```md
### PAY-01: Client pays the deposit

- **Actor:** client · **Surface:** web (pay page) · **Delivered by:** R1b (`a46bcf2`) · **Status:** Built
- **Preconditions:** a `walk-crew` project with an accepted quote (see QUO-03).
- **Steps:**
  1. Open the client page link from the client email, then **Pay with PayPal**.
  2. [human] Log in as the PayPal buyer in the popup and approve.
- **Expected:**
  - Back on the pay page: "Paid. Thank you." with the payment lines.
  - The client page shows the project in progress and the deposit as paid.
  - The team's project page shows the payment captured.
- **Edge cases:** a declined card lets the buyer pick another funding source (`INSTRUMENT_DECLINED`); opening a paid link again shows it paid.
```

- **ID:** area prefix and number, never reused.
- **Status:** `Built` (merged, walked through once in dev), `Built (not walked through)` (merged and covered by tests, never exercised in a walkthrough; edge cases inside a Built story are flagged the same way), `Verified <date> on <host> at <commit>` (last passing check), `Failing <date>: <backlog row>`, `In progress (<run>)` while the named run builds it, `Built on branch (<run>; evidence)` for unmerged work with explicitly linked staging observations and remaining coverage, `Planned (<run>)` for stories a run will deliver, or `Cancelled for this delivery (<date>)` for retained IDs whose run was cut. A cancelled story is not a failing built feature and is excluded from the current freeze unless reapproved.
- **[human]** marks a step an agent must not do: logging in to PayPal and approving a payment, uploading a Payouts Web file, connecting the plugin in Claude or ChatGPT, anything on a real Discord account.
- **Expected** lists observable results: page text, emails, links, states. Quote UI text only as it appears in the code. Results no page shows (ledger postings, fees, webhook handling) are marked "DB check (developer)".
- Stories may depend on earlier stories (named by ID) for their preconditions.

## Areas

| File | Prefix | Covers |
|---|---|---|
| [`01-accounts-and-setup.md`](01-accounts-and-setup.md) | `ACC` | Landing page, sign-up and sign-in, email verification and reset, seller setup (solo or team), PayPal connection, members and roles, settings |
| [`02-seller-page-and-catalog.md`](02-seller-page-and-catalog.md) | `CAT` | Services catalog, bio, publishing, seller page, preview, policies and legal pages |
| [`03-requests-and-quotes.md`](03-requests-and-quotes.md) | `QUO` | Quote request form and its limits, projects, assignment, quotes, the quote calculator, amendments |
| [`04-payments.md`](04-payments.md) | `PAY` | Pay page (deposit, top-up, balance), PayPal webhooks, fees in the ledger |
| [`05-delivery-and-completion.md`](05-delivery-and-completion.md) | `DEL` | Deliveries (note, link, file), changes requested, acceptance, completion, refunds to the client |
| [`06-store.md`](06-store.md) | `STO` | Digital products, store switch, checkout, orders, downloads, refunds revoking access |
| [`07-payouts.md`](07-payouts.md) | `OUT` | Payout destination, automatic payouts connection, requests, approvals, payout rules, sweeps, Payouts Web export and import |
| [`08-discord.md`](08-discord.md) | `DIS` | Discord sign-in and account link, server link, `/veetlyn link`, `/payouts setup` (built in S2, never checked on a real server) |
| [`09-agentic.md`](09-agentic.md) | `AGT` | Stories of the agentic surfaces program, by run: client contacts, hosts, the AI plugin and conversations, delivery and API, the mall, Discord, agents and analytics, ratings and profiles, the AI seller, the demo |

## Current scope (2026-10-28)

M (AGT-38–41), E (AGT-20–25, AGT-42) and AG Studio (AGT-27) are cancelled for this delivery. Keep the IDs and their historical acceptance criteria; do not run them as current commitments. AGT-26 and AGT-28 are reframed as capabilities of the one contextual agent. AGT-55–60 describe that agent's scoped environment, routing, gates, stale actions and browse/resume behavior; all are planned, not verified. V and P remain priorities, but V has no approved implementation/walkthrough plan yet. Follow [Calls and the agent](../platform/2026-10-27-calls-and-agent-design.md) when older stories disagree. Existing S2 Discord stories remain existing code with their original evidence limits.

## Running stories

1. Pick the stories for the walkthrough (a run's new stories plus the ones its changes touch).
2. Follow the steps on the host named in the run's walkthrough; stop at each [human] step and ask Mouhamed.
3. Update each story's **Status** in the same commit as the walkthrough record; a failure gets a backlog row and `Failing <date>: <row>`.
4. New features add or change stories in the run that builds them; a plan's walkthrough task lists the story IDs it checks.
