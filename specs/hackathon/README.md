# PayPal AI Hackathon: context

> **Current submission context, 2026-10-28:** this file records the PayPal event. Payleor also targets the Meta hackathon **Startup track** with the contextual agentic dash built during Oct 27–Nov 4; see the [participant guide supplied by Mouhamed](meta-ai-hackathon-participant-guide.md) and [current design](../platform/2026-10-27-calls-and-agent-design.md). Keep the two demos and their build evidence separate. M, E and AG Studio are cancelled for this delivery. Dates here are recorded targets; recheck official rules before submitting.

"Build what's next with PayPal and AI" is a global online hackathon. It is run by PayPal and administered by Devpost.

- Site: <https://paypalaihackathon.devpost.com/>
- Snapshot: these pages were fetched on 2026-10-03. Re-check the live site before relying on dates or prizes. Under Official Rules §11.4, the rules win any conflict with other hackathon pages.

| File | Contents |
|---|---|
| [`rules.md`](rules.md) | Eligibility, project and submission requirements, judging, prizes, IP and legal terms (summarized) |
| [`resources.md`](resources.md) | Official PayPal links, webinars, Discord, and the inspiration themes |
| [`sponsors.md`](sponsors.md) | The 10 sponsor tools, what each offers, and what each sponsor prize asks for |

## At a glance

| Item | Value |
|---|---|
| Core requirement | The project must **meaningfully use both PayPal and AI**. There are no tracks and no set problem statements. |
| PayPal environment | Free sandbox at <https://developer.paypal.com/> |
| AI | Any tool, model, or platform. Sponsor tools are optional. |
| Who | Individuals at or above the age of majority, teams, or organizations. See the exclusions in [`rules.md`](rules.md#eligibility). |
| Format | Online, public. 3,940 participants as of the snapshot. |
| Prizes | $67,500 in cash plus $2,250 in Render credits, which makes the site's "$69,750 in total prizes". See [`rules.md`](rules.md#prizes). |
| Questions | PayPal Discord <https://discord.gg/sJ2G6DyvSK>, or the hackathon manager at janet@devpost.com |

## Key dates (Pacific Time)

| Milestone | Date |
|---|---|
| Submissions open | Thu Oct 1, 2026, 9:00 am PT |
| **Submission deadline** | **Thu Nov 12, 2026, 12:00 pm PST** (3:00 pm EST, 20:00 UTC) |
| Judging | Tue Dec 1, 2026, 2:00 pm to Tue Dec 15, 2026, 8:00 am PT |
| Winners announced | On or around Mon Dec 21, 2026 |

Webinars run from Oct 6 to Oct 13; see [`resources.md`](resources.md#webinars). Devpost has planned maintenance on Oct 7 at 06:00 UTC.

### Discrepancies between the pages

- **Submission start:** the rules say 9:00 am PT, but the schedule page says 9:15 am PDT. This no longer matters because submissions are already open.
- **Winner announcement time:** the rules say 2:00 pm PT, but the schedule page says 9:00 am PST.
- **Oct 6 webinar end time:** the overview page says 9:45 am PT. The resources page says 9:45 pm PT, which is likely a typo.
- **Prize totals:** the overview says both "$67,500 in cash" and "$69,750 in total prizes". The gap is the Render credits.

## What the judges score

**Stage one** is pass or fail. The project must reasonably fit the theme and reasonably use the required PayPal APIs or SDKs.

**Stage two** scores five criteria with equal weight. Ties are broken in this order:

1. **Technological implementation.** How thoroughly and skillfully does the project use the PayPal developer platform and the AI tools? Is it a working, non-trivial build?
2. **Design.** Is it a complete, coherent product experience rather than a proof of concept?
3. **Potential impact.** Does it make a credible, specific case for a real problem and a real audience, and does the demo actually solve that problem?
4. **Innovation and idea.** Is it novel, and different from existing concepts?
5. **Presentation.** Does the video show the project working end to end? Does it say what problem it solves, for whom, and why it matters?

Judging may use expert panels, peer review, or "automated AI-driven analysis". Judges are not required to run the project. They may score from the description, images, and video alone. Treat the README, the description, and the video as first-class deliverables.

## Submission checklist

All of the following must be on the Devpost submission form before **Nov 12, 2026, 12:00 pm PST**:

- [ ] **Working project.** It uses the PayPal sandbox and an AI tool in a meaningful way, and it runs consistently on its target platform, as shown in the video.
- [ ] **Text description** of the features and functionality.
- [ ] **Functional demo,** either way:
  - complete setup and run instructions in the repo, or
  - a hosted demo URL.

  A mockup, a static prototype, or a non-functional demo is rejected.
- [ ] **Tools list:** which tools were used and how.
- [ ] **Public GitHub repo** with all source, assets, and run instructions. It needs an **open source license that GitHub detects**, so the license shows in the repo's About section.
- [ ] **Testing access:**
  - Include sandbox test accounts and any credentials judges need, or clear steps for getting them.
  - If the site is private, give login credentials.
  - The project must stay free to use and unrestricted until judging ends, on Dec 15, 2026.
- [ ] **Demo video:**
  - under 3 minutes
  - public on YouTube
  - shows the project running on its real device
  - no third-party trademarks or copyrighted music without permission
- [ ] **English.** Everything is in English, or comes with English translations.
- [ ] **Existing project?** If the project existed before Oct 1, 2026, explain what changed significantly during the submission period.
- [ ] **Sponsor prize?** If you are aiming for a sponsor prize, the project must actually use that sponsor's tool. See [`sponsors.md`](sponsors.md).

> **Credentials in the repo.** The rules ask for test credentials so that judges can run the build. Never commit secrets: `refs/AGENTS.md` forbids it. Prefer a hosted demo URL. Otherwise, put sandbox-only values in the Devpost testing-instructions field or in a clearly labeled sandbox `.env.example` flow. Use sandbox values only, never live ones.

## How this maps to our project

The planned project is an ecommerce app on PayPal with hosted checkout, headless APIs, and AI or agentic commerce. The PayPal technical references are indexed in [`references/README.md`](../references/README.md), and the agent rules are in [`references/AGENTS.md`](../references/AGENTS.md). The points below are our own analysis, not official guidance.

**Prizes that fit.** The project fits three prizes directly:

- **Best Use of Agentic Commerce** ($5,000)
- **Best Use of PayPal + AI** ($5,000)
- the grand prizes

A project can win at most one grand prize or one honorable mention, plus one sponsor prize.

**Sponsor tools that fit an agentic store:**

- **Channel3:** a product catalog API and MCP server for shopping agents.
- **Elastic:** product search and RAG.
- **Render:** hosts the demo URL and runs background agent workflows.
- **APIMatic:** a Context Plugin that gives your coding agent PayPal API context.

Pick one sponsor prize to aim for. Only one sponsor prize can be won.

**PayPal surface to show:**

- Server-side Orders v2 with v6 checkout, for the hosted mode.
- REST operations driven by the agent, for the headless mode. Examples are orders, refunds, tracking, and invoices.
- PayPal `agent-toolkit` or the PayPal MCP server, as the bridge between the LLM and PayPal.

The resources page links the Agent Toolkit and MCP quickstarts directly; see [`resources.md`](resources.md#ai-and-agent-development).

**Early-access risk.** Store Sync, the Cart API, and Agent Ready are early access (see `refs/README.md` §6). Confirm on Discord or at <https://docs.paypal.ai/> that hackathon sandbox accounts can use them before you depend on them. Have a fallback that uses the Orders v2 API and agent-toolkit. Decided 2026-10-14: the submission does not use them; the agentic commerce story is the service hire and the mall (cart in the chat, checkout on Payleor) through the Payleor plugin ([program §6](../platform/2026-10-13-agentic-surfaces-program.md)).

**Human in the loop.** An agent must get explicit buyer confirmation before any capture or refund. This follows `refs/AGENTS.md`, and it also makes a good moment to show in the demo video.

**Be clear about third-party products.** If the agent shops Channel3's catalog of other retailers' products and checks out through your own sandbox merchant account, say plainly that this is a simulation.
