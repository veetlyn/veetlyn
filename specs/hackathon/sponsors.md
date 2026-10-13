# Sponsor tools

These summaries come from the sponsor pages at `https://paypalaihackathon.devpost.com/details/<sponsor>`, fetched 2026-10-03. All sponsor tools are **optional**. A sponsor prize requires that the project actually use that sponsor's tool; a project can win only one sponsor prize. Prize amounts are in [`rules.md`](rules.md#prizes).

| Sponsor | What it is | Hackathon offer | Prize |
|---|---|---|---|
| [AG Grid](https://paypalaihackathon.devpost.com/details/aggrid) | Data grid, charts, and AG Studio embedded dashboards, with the Studio Agent Framework | none stated | 1st $5,000, 2nd $2,000, 3rd $1,000 ×3 |
| [APIMatic](https://paypalaihackathon.devpost.com/details/apimatic) | A Context Plugin for PayPal, which gives AI coding agents PayPal API and SDK context | 1 month of APIMatic Basic for anyone who used the plugin. PayPal is pre-enabled, so no extra sign-in is needed. | $1,000 + 6 months of Business, ×3 |
| [Astropods](https://paypalaihackathon.devpost.com/details/astropods) | A platform to deploy and run AI agents, defined in a declarative spec and pushed with a CLI. Docs: <https://docs.astropods.com> | none stated | none |
| [Bryntum](https://paypalaihackathon.devpost.com/details/bryntum) | Gantt, Scheduler, and Calendar UI components | 45-day trial (<https://bryntum.com/download>) | $1,000 ×3 |
| [Channel3](https://paypalaihackathon.devpost.com/details/channel3) | One API and MCP server for normalized product data: over 100M products from more than 25k retailers, with prices, variants, availability, and buy links | 20,000 free credits with code `PAYPAL-HACKATHON-2026` (<https://trychannel3.com/developers>). Top-ups through `#channel3` on Discord. | $1,500 ×1 |
| [Elastic](https://paypalaihackathon.devpost.com/details/elastic) | Elasticsearch for hybrid and vector search, plus Agent Builder, Workflows, ES\|QL, and A2A/MCP | 14-day trial at <https://ela.st/elastic-paypal-hackathon>, extendable by 30 days. A free local install is also available. | none |
| [KERNEL](https://paypalaihackathon.devpost.com/details/kernel) | Cloud browsers for agents, with anti-bot handling, persistent auth, and live view and replay | $50 in credits (<https://www.kernel.sh/docs>) | none |
| [Postman](https://paypalaihackathon.devpost.com/details/postman) | An API platform for design, testing, docs, and monitoring | plan help on Discord | none |
| [Render](https://paypalaihackathon.devpost.com/details/render) | A cloud platform for web services, databases, workers, and Render Workflows, a task engine for agents and jobs | credits; follow the instructions on the sponsor page | Credits: $1,000, $750, $500 |
| [Zapier](https://paypalaihackathon.devpost.com/details/zapier) | Zapier MCP, which lets AI tools act across more than 9,000 apps, PayPal included | 14-day Professional trial for new accounts, with no card needed | none |

## What each sponsor prize asks for

- **AG Grid.** Judging covers both how the dashboard looks and how it was built.
  - They want polish: custom widgets, theming, and layout tools, not plain AG Grid or AG Charts.
  - They encourage the Studio Agent Framework, either with a custom agent that talks to Studio's built-in agents or with a swapped-in harness.
  - Sample ideas:
    - storefront analytics
    - a refund or failed-payment anomaly agent
    - a donation dashboard
    - natural-language widgets for questions like "PayPal revenue by segment"
    - an unpaid-invoice nudge bot
- **APIMatic.** Use the Context Plugin to build the PayPal integration. The sponsor page refers to a form that holds the subscription offer and its extra terms; the form link did not come through in the fetched page. Details are on the resources page, in the Oct 7 webinar, and from the APIMatic team on Discord.
- **Bryntum.** The prize goes to the best use of Gantt, Scheduler, or Calendar: the cleanest timeline, the smartest resource booking, or an agent that drives the schedule. Sample ideas:
  - payment tranches as Gantt dependencies
  - rentals that lock in only when a PayPal payment clears
  - event ticketing
  - a subscription renewal radar
  - a dispute triage board
  - an agent that reschedules work based on PayPal payment events
- **Channel3.** The project must call the Channel3 API or MCP server as a meaningful part of the product, for search, product enrichment, or recommendations. **Projects that only mention Channel3 without calling it do not qualify.**
- **Render.** The project must use any Render tools. They suggest deploying on Render and coordinating agents, background jobs, and pipelines with Render Workflows.

## Our decision (2026-10-05)

Design: [`../platform/2026-10-05-sponsor-integrations-design.md`](../platform/2026-10-05-sponsor-integrations-design.md).

- **AG Grid is the sponsor prize we compete for:** a store analytics page in AG Studio with three custom widgets (Money flow, Dispute clock, Agent vs human sales) and our Admin agent as Studio's primary agent, delegating to Studio's built-in agents.
- **Channel3:** start a product from a link or photo, a market price panel and agent tool, and optional competitor price alerts. Merchant side only; buyers never see it.
- **Render:** Render Workflows runs bulk catalog import (Channel3 lookup, `sharp` image processing, R2). The user redeemed $50 in Render credits.
- **Postman:** optional in the last days, a public collection of our protocol endpoints.
- **Not used:** APIMatic (dropped), Bryntum (would compete with AG Grid for our one sponsor prize), Elastic (overlaps AI Search; trial ends before judging ends), Zapier, KERNEL, Astropods.
- **Judges:** staff from AG Grid, APIMatic, Bryntum, Channel3, Elastic, Postman and Render are on the main judging panel (`rules.md` §6).
- **Trial timing:** the AG Studio and Bryntum trials last 45 days. Request the AG Studio key around Nov 1 so it covers judging (Dec 1–15).

## Fit for our ecommerce and agentic project

This section is our own analysis from 2026-10-03, before the decision above. It is not official guidance.

| Sponsor | Fit | Possible role |
|---|---|---|
| Channel3 | High | Product catalog for a shopping agent: product search and recommendations, with checkout through PayPal. Say clearly in the demo that retailer products are checked out in sandbox only. |
| Render | High | Host the demo URL, which meets the functional-demo requirement without judges running a local setup. Run agent and webhook workers. |
| APIMatic | Medium | Low effort if a coding agent builds the PayPal integration through the Context Plugin. The prize judges how the tool was used, so use it for real. |
| Elastic | Medium | Hybrid or vector product search, or RAG over order history. There is no dedicated prize. |
| AG Grid | Medium | Merchant back-office dashboard for orders, refunds, and disputes, with an agent that builds widgets. It has the largest sponsor prize pool, but the bar for dashboard polish is high. |
| Zapier, KERNEL, Astropods, Postman, Bryntum | Low | Only if a specific feature needs one. Note that KERNEL's anti-bot browsing on third-party sites may conflict with those sites' terms. |
