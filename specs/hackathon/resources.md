# Hackathon resources

These links come from <https://paypalaihackathon.devpost.com/resources> and the overview page, fetched 2026-10-03.

- **Support:** the PayPal Discord, <https://discord.gg/sJ2G6DyvSK>. The PayPal and sponsor teams are there, and some sponsors have their own channels, such as `#channel3`.
- **Local copies.** Several of these links point at repos already cloned under `../../refs/`, as noted below. Read the local copy first, following [`references/AGENTS.md`](../references/AGENTS.md).

## Get started

1. Create a PayPal Developer account, which takes about 5 minutes: <https://developer.paypal.com/>
2. Set up the sandbox: <https://developer.paypal.com/dashboard/>. You need a REST app with a client ID and secret, plus test buyer and merchant accounts.
3. Review the inspiration themes below.

## Webinars

| When (PT) | Session | Link |
|---|---|---|
| Tue Oct 6, 9:00 to 9:45 am | Start building with PayPal | [Zoom registration](https://us02web.zoom.us/webinar/register/9017891382824/WN_uifdBF0pTfe8E0jm3lLayw) |
| Wed Oct 7, 9:00 to 9:30 am | Power Your PayPal Hackathon Project with APIMatic Context Plugins | [Teams event](https://events.teams.microsoft.com/event/9bd9c158-55c9-4d7f-81b4-d419a327f1df@fb007914-6020-4374-977e-21bac5f3f4c8) |
| Mon Oct 12, 7:00 to 7:45 am | Build a payments dashboard without building a dashboard | [Teams event](https://events.teams.microsoft.com/event/4f91e1d9-eb30-42b9-ac36-e6b0eaefc4ae@fb007914-6020-4374-977e-21bac5f3f4c8) |
| Tue Oct 13, 1:00 to 2:00 am | Start building with PayPal (repeat session for other time zones) | [Teams event](https://events.teams.microsoft.com/event/bad9d43c-0044-41ef-afaf-cbb1fddaef4f@fb007914-6020-4374-977e-21bac5f3f4c8) |

## Core PayPal integration

| Resource | URL | Local reference |
|---|---|---|
| PayPal Developer docs | <https://developer.paypal.com/> | |
| PayPal Payments | <https://developer.paypal.com/payments/> | |
| PayPal Checkout | <https://developer.paypal.com/checkout/> | `refs/paypal-js`, `refs/ruleshub` |
| PayPal JavaScript SDK v6 | <https://developer.paypal.com/sdk/js/> | `refs/paypal-js` (v6 loader and types) |
| PayPal REST API | <https://developer.paypal.com/api/rest/> | `refs/paypal-rest-api-specifications`, `refs/PayPal-TypeScript-Server-SDK` |
| Developer Dashboard (sandbox apps and accounts) | <https://developer.paypal.com/dashboard/> | |
| Getting started with the PayPal sandbox | <https://github.com/paypaldev/getting-started-with-paypal-sandbox> | not cloned |

## Useful payment capabilities

| Capability | URL |
|---|---|
| Low-code and no-code (payment links and buttons) | <https://developer.paypal.com/payment-links-buttons/overview> |
| Pay Later | <https://developer.paypal.com/pay-later/overview> |
| Subscriptions | <https://developer.paypal.com/platforms/subscriptions> |
| Invoicing | <https://developer.paypal.com/invoicing/about> |
| Payouts | <https://developer.paypal.com/docs/payouts/> |
| Disputes | <https://developer.paypal.com/platforms/disputes/overview> |
| Donations | <https://developer.paypal.com/sdk/donate/> |
| Webhooks | <https://developer.paypal.com/api/webhooks/overview> |

To map each capability to its spec file, server SDK controller, and agent tool, use the capability map in `refs/README.md` §4.

## AI and agent development

| Resource | URL | Local reference |
|---|---|---|
| PayPal AI Toolkit | <https://github.com/paypal/AI-Toolkit> | `refs/AI-Toolkit` |
| PayPal AI docs | <https://docs.paypal.ai/> | |
| Agent Toolkit quickstart | <https://docs.paypal.ai/developer/tools/ai/agent-toolkit-quickstart> | `refs/agent-toolkit` |
| MCP server quickstart | <https://docs.paypal.ai/developer/tools/ai/mcp-quickstart> | `refs/agent-toolkit` (`@paypal/mcp`) |
| Agent tools reference | <https://docs.paypal.ai/developer/tools/ai/agent-tools-ref> | `refs/agent-toolkit/typescript/src/shared/tools.ts` |

`docs.paypal.ai` is the AI-focused PayPal docs site that the hackathon points to. For agent toolkit and MCP questions, treat it as being on the same level as `developer.paypal.com` in the source order in `refs/AGENTS.md`.

## Inspiration themes

These are examples from the organizers. They are not tracks, and they are not required.

- **AI agents or automation.** Agents that **actually transact** for the user, not just recommend. Examples:
  - a shopping agent that checks out for you
  - a scheduler that pays contractors when a job is marked complete
  - agent-to-agent negotiation and settlement
- **Money movement experiences.** Faster, simpler, or more flexible ways to move money. Examples:
  - send money to a phone number
  - a freelancer view of payments across clients
  - instant payouts for gig workers when a task is approved
  - splitting a dinner bill by scanning the receipt
  - a donation split across several causes
- **Business solutions.** Tools for merchants, freelancers, creators, platforms, and marketplaces. Examples:
  - invoicing in multiple currencies
  - creator tips and memberships
  - a marketplace checkout that splits payment between the platform and its sellers
  - a point-of-sale add-on for small merchants
- **Consumer experiences.** Easier ways to pay, get paid, or track money. Examples:
  - a budget app that categorizes PayPal transactions automatically
  - "request money" inside a chat app
  - a simpler checkout for students, families, or seniors
- **Social impact.** Wider access, or good done in the world. Examples:
  - an accessible, multi-language donation platform
  - microloans or fundraising for underbanked users
  - automated nonprofit payouts to field partners
  - community money pools, such as a solar co-op or a cleanup fund
