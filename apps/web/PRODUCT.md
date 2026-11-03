# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Designed for each audience equally (confirmed 2026-11-03); each surface serves its own user:

- **Seller teams:** owners and admins of agencies and studios, managers and freelancers. They take requests, quote, deliver, get paid and pay members. Solo sellers are the same role alone.
- **Clients:** people who hired a seller. They follow a project through a private link, with no account: questions, quotes, deposit, delivery, changes, balance.
- **Shoppers:** guests who buy a digital download from a seller page and download it from their order page.
- **Workspace owners paying for Veetlyn:** the billing person of a workspace (plan, trial, card, invoices).

## Product Purpose

Veetlyn lets sellers of services and digital products sell where clients ask AI. A client's AI (Claude, ChatGPT) finds an offer, asks questions and requests a quote; the client pays through PayPal on Veetlyn; the team delivers and is paid by its own rules. Success: a request becomes a paid, delivered project and paid members without the seller leaving Veetlyn, and every money movement is one a person approved.

## Positioning

Agentic commerce for services with a person on every payment: the client's AI and the team's assistant can draft and prepare, but quotes, payments, refunds and payouts are confirmed by a person. Money moves through PayPal directly between client and seller; Veetlyn never holds funds.

## Operating Context

- Desktop at work for setup, quoting, deliveries and payouts; phone to follow up: notifications, approvals, replies, paying (confirmed).
- Every page that takes money hands off to PayPal (popup or redirect) and returns; Polar's hosted checkout and portal handle Veetlyn's own subscriptions.
- Clients and shoppers arrive from an email link or their AI assistant, often on a phone, usually once.
- One account can belong to several workspaces (each billed separately) and switch between them; a team may also run a store.
- The dashboard assistant (Calls) answers from what the person may see and drafts actions as cards to confirm.

## Capabilities and Constraints

- Roles: workspace owner/admin; services-team admin, manager, freelancer; client (link, no account); shopper (guest).
- Project lifecycle: request, quoting, awaiting deposit, in progress, delivered, changes, awaiting balance, completed; also declined, expired, abandoned.
- Money: deposit, top-up and balance payments; management fee; team, manager and member cuts; refunds; PayPal disputes; payout requests, approvals, rules, automatic payouts and Payouts Web export.
- Plans and limits per workspace (services Solo/Team/Agency, stores Starter/Grow/Scale, bundles); 14-day no-card trial, 2-day grace, then selling pauses while paid work continues.
- Sandbox banner on staging; currency formatting per project currency (USD, EUR).
- Undecided: plan-choice onboarding before the trial (backlog); invoices and receipts (backlog).

## Brand Commitments

- Name: Veetlyn. Assistant speaks as "Veetlyn".
- The app must feel like the same brand as the marketing site (veetlyn.com, `apps/web/src/app/(site)`), which stays as it is (confirmed). The site is the visual reference for the app.
- The large "P" illustration on the authentication screens refers to the old Payleor name and must be removed (confirmed).
- Voice (inferred from existing copy): plain, short sentences, says what happens with money and when, no hype.

## Evidence on Hand

- Real product flows on staging (walkthrough 2026-11-03, screenshots in `/tmp/opencode/e2e-visible-fresh/`).
- No customer testimonials, case studies or usage numbers: do not fabricate any. Marketing examples (Walk Crew, Logo Bot, Maison Lune, Clay Room) are labelled samples.

## Product Principles

1. Money is never ambiguous: amount, who pays whom, fee, and what happens next are visible at the moment of decision.
2. A person confirms; the UI makes confirmation deliberate and its effect explicit, never hidden in a menu.
3. Each role sees what it may act on; what it cannot do is explained, not just missing.
4. Status first: every project, payment and payout says where it stands and whose turn it is.
5. Clients and shoppers succeed on a first visit with no account and no training.

## Accessibility & Inclusion

- Keyboard and screen-reader usable flows for every payment and confirmation (inferred: payments and approvals are the critical paths).
- Works on small phones for client, shopper and follow-up flows (confirmed usage).
