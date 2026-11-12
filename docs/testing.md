# Testing Veetlyn by hand

This page is for anyone who wants to walk through Veetlyn: a teammate, a judge, a reviewer or an AI agent. It says which accounts to use, where their logins are kept and how to read the emails the app sends.

All payments use the **PayPal sandbox**, so no real money moves. Automated tests (`pnpm test`) are covered in [development.md](development.md#testing).

## Pick your path

| You are | Where to test | What you need |
|---|---|---|
| A judge or visitor | Staging: `dash.staging.veetlyn.com` | A browser. Sign up with any email you can read, and pay with the sandbox buyer shown on the checkout page. |
| A teammate | Staging, or local over the tunnel | The shared test logins from the maintainer (see [Where the logins live](#where-the-logins-live)). |
| An outside contributor | Local | Your own PayPal sandbox accounts from [developer.paypal.com](https://developer.paypal.com) and your own email inbox. |
| An AI agent | Whichever stage the person names | The same files as a teammate. An agent never makes a payment, not even a sandbox one (see [Rules for agents](#rules-for-agents)). |

Production is behind the waitlist, so nobody tests there. See [environments.md](environments.md).

## The accounts

### PayPal sandbox accounts

A walkthrough needs two sides: someone who pays (a **buyer**, a sandbox *personal* account) and someone who gets paid (a **seller**, a sandbox *business* account). Each one has a fixed job, so payments and payouts never get mixed up between tests.

| Account | Env keys | Job |
|---|---|---|
| Buyer 1 | `SANDBOX_BUYER_1_EMAIL`, `SANDBOX_BUYER_1_PASSWORD` | The public test buyer. The checkout banner shows its login to everyone (`SANDBOX_BUYER_EMAIL` / `SANDBOX_BUYER_PASSWORD` default to it). Judges pay with it. |
| Buyer 2 | `SANDBOX_BUYER_2_*` | Pays for projects during a teammate's walkthrough: deposits and balances. Kept private. |
| Buyer 3 | `SANDBOX_BUYER_3_*` | Spare. Use it when a test needs a second, separate payer. Kept private. |
| Seller 1 | `SANDBOX_SELLER_1_*` | Connects to a **new** test team, so you see PayPal's full consent screen. |
| Seller 2 | `SANDBOX_SELLER_2_*` | Connects to a second team, to check that teams stay apart. |
| Seller 3 | `SANDBOX_SELLER_3_*` | Connected to **Walk Crew**, the standing test team. Its payouts land here. |
| Test card | `SANDBOX_CARD_NUMBER`, `SANDBOX_CARD_EXPIRY`, `SANDBOX_CARD_CVV` | Public sandbox card for the guest card checkout. Shown on checkout pages. |

Do not sign in to PayPal as the account that owns the platform's REST app (the one behind `PAYPAL_CLIENT_ID`). Connecting a team with it would connect Veetlyn to itself.

Before a seller connects, check which account the browser is signed in to on `sandbox.paypal.com`. PayPal keeps the last session, so you may still be signed in as someone else.

### The test inbox (AgentMail)

The app sends emails for sign-up, password resets, client links, quotes and receipts. Testers read them in a shared [AgentMail](https://agentmail.to) inbox, which has an API, so a person or an agent can read it without a mail client.

| Env key | What it is |
|---|---|
| `AGENT_MAIL_INBOX` | The inbox address, `<name>@agentmail.to` |
| `AGENT_MAIL_API_KEY` | The AgentMail API key for that inbox. Send it as a Bearer token. |

One inbox covers every test person, because AgentMail delivers plus addresses to the same inbox:

| Address | Use it for |
|---|---|
| `<inbox>@agentmail.to` | The Walk Crew admin (team owner) on dev and staging |
| `<inbox>+client1@agentmail.to`, `+client2`, … | Clients. A new number gives you a new, unverified client. |
| `<inbox>+prod1@agentmail.to` | Reserved for the production smoke test. Do not use it for walkthroughs. |

Read the inbox from a shell, with the key loaded from the env file so it is never printed:

```bash
set -a; . apps/server/.env; set +a
B="https://api.agentmail.to/v0/inboxes/$AGENT_MAIL_INBOX/messages"

# Latest 10 messages: time, recipients, subject, id
curl -s -H "Authorization: Bearer $AGENT_MAIL_API_KEY" "$B?limit=10" \
  | jq -r '.messages[] | [.timestamp, (.to|tostring), .subject, .message_id] | @tsv'

# One message body (paste an id from the list)
ID='<message id>'
curl -s -H "Authorization: Bearer $AGENT_MAIL_API_KEY" "$B/$(jq -rn --arg s "$ID" '$s|@uri')" \
  | jq -r '.text // .html'
```

Client links (`/c/…`) and pay links (`/pay/…`) in these emails work like passwords. Don't paste them into issues, PRs or chats.

### Test team and app logins

- **Walk Crew** is the standing test team. Its owner is the bare inbox address and its PayPal seller is seller 3. On staging it is served at `walk-crew.staging.veetlyn.app`.
- **Don't store app passwords.** To sign in as a test person, open **Forgot password** on the dashboard, read the reset email in the inbox and set a new password. That always works, even after someone else has changed it.
- New teams for one test (for example "Walk Consent" for the PayPal consent screen) are fine on staging. Give them a name that says what they are for.

### People on the local Walk Crew

The local dev database has these people besides the owner. Each has a fixed job, so reuse them instead of adding more.

| Person | Login | Role on Walk Crew | Use it for |
|---|---|---|---|
| Walk Through | `<inbox>@agentmail.to` | Admin (workspace owner) | The team owner; also the member whose payouts the demo shows |
| Walk Admin Two, Walk Admin Three | `<inbox>+admin2@…`, `+admin3@…` | Admin | Payouts that need a second admin |
| Aïcha Walk, Ben Walk | `<inbox>+aicha@…`, `+ben@…` | Freelancer | Competing quotes on one request (Rita's "Logo refresh") |
| Spike MCP | `<inbox>+spike-mcp@…` | Client | Projects started from an AI assistant |
| Dev Merchant | `dev-merchant@example.com` | Freelancer | Earnings waiting for a payout destination |
| Design Check | `design-97d920@example.com` | Admin (owns its own workspace) | Design reviews of the dashboard |
| Demo Reviewer | `demo-review@example.com` | Admin | Recording the product video and end-to-end reviews |

The `@example.com` accounts have no inbox, so **Forgot password** cannot reach them. Sign in as them only in a browser profile that already holds their session. To start fresh, sign up a new `<inbox>+name@agentmail.to` person instead.

### The dashboard assistant

The assistant needs `AGENT_API_KEY`, `AGENT_BASE_URL` and `AGENT_MODEL` in `apps/server/.env`. Without them, Threads says "The assistant is not set up on this server yet". Copy all three together from a checkout that has them, then restart `pnpm dev`. Every question a test asks leaves a thread in the person's sidebar, and counts toward the daily limit (`AGENT_DAILY_TURNS`, 200 when empty).

## Where the logins live

Nothing secret is stored in this repository. The values sit in ignored env files and in GitHub environments:

| What | Where |
|---|---|
| PayPal sandbox buyers, sellers and test card | `packages/infra/.env` (keys listed in `packages/infra/.env.schema`) |
| AgentMail inbox and API key | `apps/server/.env` (keys in `apps/server/.env.schema`; test-only, never deployed) |
| Platform PayPal app, Resend, Better Auth and the rest of the server config | `apps/server/.env` (keys in `apps/server/.env.schema`) |
| Staging-only values (database URL, webhook id, generated secrets) | `packages/infra/.env.staging.local` |
| Deployed stages | GitHub environments `staging` and `production` (`pnpm -F @jendal-workspace/infra github-env <stage>` copies a local file there and prints names only) |

**Teammates** get the filled `packages/infra/.env` and `apps/server/.env` from the maintainer through a password manager or another private channel, never through the repo, an issue or a chat log. Each file goes in its own place in your checkout. Both are already in `.gitignore`.

**Outside contributors** fill the same files themselves. Create sandbox accounts in the [PayPal developer dashboard](https://developer.paypal.com) under **Testing tools → Sandbox accounts**: three personal accounts for the buyers and three business accounts for the sellers. Put the logins in `packages/infra/.env`. Any inbox you can read works in place of AgentMail. Skip the two `AGENT_MAIL_*` keys and use your own address.

Each worktree has its own copy of these files. If a value is missing, the Varlock error names the key. Copy the file from your main checkout (`cp -n`, so you don't overwrite anything) rather than retyping it.

## A standard walkthrough

The full client-to-payout loop, in the order the app expects it:

1. **Sign in** as the Walk Crew admin, using a password reset through the inbox.
2. **Open a project** for a client at `<inbox>+clientN@agentmail.to` and use **Email link** to send the client link. Open the link from the inbox. The client's email should now show **Verified**.
3. **Assign** the work and **send a quote**.
4. As the client, **accept** the quote from the client link and **pay the deposit** with **buyer 2**.
5. As the team, **submit a delivery**. As the client, **accept** it and **pay the balance** with buyer 2.
6. Check that the **payout** reaches seller 3.

For a single story, follow its steps in the story book. It is in the private `veetlyn/specs` repository, and each story says what to check.

Write down what you saw: pass or fail per step, with the URL and a screenshot of any failure. Maintainers record walkthrough results in the specs repository, next to the plan they test.

## Rules for agents

- **Never make a payment.** Buyers' PayPal steps are always done by a person, even in the sandbox. When you reach one, stop and hand over with the **exact sandbox email** to use, for example: *"Pay the $120 deposit as buyer 2, the email next to `SANDBOX_BUYER_2_EMAIL` in `packages/infra/.env`."*
- Never print secret values. Load env files into the environment (`set -a; . file; set +a`) and mask them in output. Write links you need later to a private file, not to the transcript.
- Keep helper scripts and generated passwords in `~/.local/state/<project>-walk/` (mode `600`), never in `/tmp` or the repo.
- Use the plus addresses above for new people, and password resets to sign in.

## Troubleshooting

- **No email arrives:** check `RESEND_API_KEY` is set (without it every send fails quietly), then list the inbox again after a few seconds. Delivery usually takes under 10 seconds.
- **PayPal says "already set up, return to …":** the browser is still signed in to PayPal as an account that is already connected. Sign out at `sandbox.paypal.com` and sign in as the seller the test needs.
- **The PayPal popup doesn't open locally:** reload once. It is a known glitch on the first restart.
- **Webhooks never land on staging:** the stage needs its own `PAYPAL_WEBHOOK_ID`, registered on the sandbox app for that stage's API URL.
