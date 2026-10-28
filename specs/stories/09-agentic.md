# Agentic surfaces (AGT)

> **Current scope, 2026-10-28:** [Calls and the agent](../platform/2026-10-27-calls-and-agent-design.md) and the revised [run board](../PROGRESS.md) take precedence. M, E and AG Studio are cancelled for this delivery. Cancelled IDs remain below for traceability; their expected results are historical criteria, not current promises. D now describes one contextual agent, not separate intake/Studio agents. New runtime stories are planned and unverified.

Planned stories for the agentic surfaces program (`../platform/2026-10-13-agentic-surfaces-program.md`) and the action registry and client contacts design (`../platform/2026-10-13-action-catalog-design.md`). Each run's section names its plan and the task that walks its stories (the run board in `../PROGRESS.md` has the same mapping); each run's walkthrough checks its stories here; the run's plan may sharpen a story (exact texts, pages) when it builds it, and then quotes UI text from the code. Run A1 changes nothing a person can see, so its proof is the existing story book passing unchanged.

Security rules every story here assumes (program §3.4):

- A member of the project's team is never its client, whatever link, contact or email they hold.
- Only identities Payleor verified count: an email whose link was clicked, a Discord user who interacted, a signed-in account.
- Built agent policy remains enforced by `perform`. For the planned contextual agent, Ask me drafts for authorized confirmation; Auto is limited to expressly configured eligible transitions and limits, never client acceptance or PayPal checkout approval. No prompt or scope change grants authority; an API key never acts as a client. The Auto allowlist and actor/delegation contract must be approved before those execution stories are implemented.
- Accepting a quote or a delivery from an AI client needs a press on a Payleor widget button.
- Every payment needs the payer's PayPal approval on the pay page.

## A2: client contacts

Plan: [`2026-10-15-a2-client-contacts.md`](../archive/platform/plans/2026-10-15-a2-client-contacts.md), walked in Task 11.

### AGT-01: The team manages a project's clients in a Clients section

- **Actor:** team admin · **Surface:** web (`{dash}/walk-crew/projects/{id}`) · **Delivered by:** A2 · **Status:** Built (A2; merged `1a0e640`, walkthrough recorded 2026-10-16 in the run board; not a new production verification)
- **Preconditions:** a walk-crew project with one client contact.
- **Steps:**
  1. Open the project page.
  2. Add a second client by email.
  3. Remove the primary client; then try to remove the last one.
- **Expected:**
  - The project page has a Clients section listing each contact's name and identities, each marked verified or not; it no longer shows a bare client email or the client link.
  - The added contact appears with an unverified email.
  - Removing the primary makes the other contact primary; removing the last contact is refused.
  - The projects list shows the primary contact's name.
- **Edge cases:** adding or removing a client while someone sends a quote or a delivery does not make either fail (no project version bump). Only members who can start projects may add or remove clients.

### AGT-02: The team emails the client link and reissues it

- **Actor:** team admin, client · **Surface:** web, email · **Delivered by:** A2 · **Status:** Built (A2; merged `1a0e640`, walkthrough recorded 2026-10-16 in the run board; not a new production verification)
- **Preconditions:** AGT-01; the contact's email is a client AgentMail address.
- **Steps:**
  1. On the project page, email the client link to the contact.
  2. Open the link from the email.
  3. Reissue the link; open the old link again, then the new one from the new email.
- **Expected:**
  - The client receives an email with their own link.
  - Opening it shows the client page and marks that email verified in the Clients section.
  - After the reissue the old link is refused and the new one works.
- **Edge cases:** a contact removed from the project loses access through any link it held.

### AGT-03: The team previews the client page without acting as the client

- **Actor:** team admin, freelancer · **Surface:** web · **Delivered by:** A2 · **Status:** Built (A2; merged `1a0e640`, walkthrough recorded 2026-10-16 in the run board; not a new production verification)
- **Preconditions:** a project with a sent quote.
- **Steps:**
  1. On the project page, choose preview as client.
- **Expected:**
  - The client page shows read-only: the quote and payment state as the client sees them, with no action that accepts, pays or requests changes.
  - The team's project view returns no client link anywhere.
- **Edge cases:** none.

### AGT-04: A team member holding a client link is refused as the client

- **Actor:** freelancer · **Surface:** web (client page) · **Delivered by:** A2 · **Status:** Built (A2; merged `1a0e640`, walkthrough recorded 2026-10-16 in the run board; not a new production verification)
- **Preconditions:** the assigned freelancer of a walk-crew project holds a valid client link for it (for example a link issued before A2, or a contact whose email is the freelancer's own).
- **Steps:**
  1. Signed in as the freelancer, open the client link and try to accept the quote.
  2. Try to accept a delivery the same way.
- **Expected:**
  - Both are refused and nothing changes; the action log records the refusal.
- **Edge cases:** a signed-in member whose verified account email matches a verified client email of the project is refused too.

### AGT-05: Unverified identities give no authority

- **Actor:** anonymous requester · **Surface:** web (`{seller}/request`) · **Delivered by:** A2 · **Status:** Built (A2; merged `1a0e640`, walkthrough recorded 2026-10-16 in the run board; not a new production verification)
- **Preconditions:** a client whose email is verified on a walk-crew project.
- **Steps:**
  1. Without that inbox, submit a quote request on the walk-crew seller page with that client's email.
- **Expected:**
  - The request creates a new contact with an unverified email; the existing client's projects stay out of reach for the requester.
  - The link for the new request goes only to that email address.
- **Edge cases:** today's request limits still apply (per IP, per email per hour, three open requests per email per team).

### AGT-06: Client links sent before A2 keep working

- **Actor:** client · **Surface:** web (client page) · **Delivered by:** A2 · **Status:** Built (A2; merged `1a0e640`, walkthrough recorded 2026-10-16 in the run board; not a new production verification)
- **Preconditions:** a project created and emailed before A2 (the migration turned its client into a contact).
- **Steps:**
  1. Open the old client link from the old email.
- **Expected:**
  - The client page opens and acts for the project's primary contact; that contact's email becomes verified.
- **Edge cases:** once the team reissues the link or removes the contact, the old link stops working.

## H: hosts and first deploy

Plan: not written. Its walkthrough also runs the whole book on the deployed hosts.

### AGT-07: The platform runs on the deployed sandbox hosts

- **Actor:** team admin, client · **Surface:** web (`{site}`, `{dash}`, `{seller}`) · **Delivered by:** H · **Status:** Walked through 2026-10-20 on production (H plan Outcome)
- **Preconditions:** run H deployed; `{dash}` is `https://dash.payleor.com`.
- **Steps:**
  1. Open `{site}`, sign in on `{dash}`, open `{dash}/walk-crew`.
  2. Open the walk-crew seller page on `{seller}` and request a quote.
  3. Run a project payment with the pay page.
  4. [human] Approve the payment in the PayPal popup as the PayPal buyer.
- **Expected:**
  - Every page loads from the deployed Workers, not the dev tunnel.
  - The request email links to the deployed client page; the payment is captured and PayPal's webhook reaches the deployed api Worker.
  - Every story in areas 01 to 07 can run against these hosts.
- **Edge cases:** PayPal return URLs (onboarding, Log in with PayPal, automatic payouts) come back to the deployed hosts.

### AGT-08: PayPal shows the partner app as Payleor

- **Actor:** team admin · **Surface:** PayPal consent screens · **Delivered by:** H · **Status:** Walked through 2026-10-20 on production (H plan Outcome)
- **Preconditions:** AGT-07.
- **Steps:**
  1. Start turning on automatic payouts (OUT-04).
  2. [human] Read the PayPal consent screen.
- **Expected:**
  - PayPal names the app Payleor (no longer "Test Store").
- **Edge cases:** none.

## C: client's AI plugin

Plan: [`2026-10-15-c-plugin.md`](../archive/platform/plans/2026-10-15-c-plugin.md); Task 12 sharpened these stories to what was built (2026-10-20), Task 17 walks them. The plugin zips come from `pnpm plugin:zip` (add `--mcp-url https://api.staging.payleor.com/mcp` for staging); the demo data from `packages/db/scripts/demo-seed-conversations.ts`.

### AGT-09: A client connects the Payleor plugin in Claude and ChatGPT

- **Actor:** client · **Surface:** Claude, ChatGPT · **Delivered by:** C · **Status:** Walked through in Claude on staging (2026-10-20); ChatGPT checked for consent and the golden prompts (2026-10-21)
- **Preconditions:** the plugin deployed on the platform hosts.
- **Steps:**
  1. [human] Add the Payleor connector in Claude, then in ChatGPT.
  2. [human] Sign in to a Payleor client account through the OAuth screen, then read the consent page "Connect your AI assistant" on `{dash}/oauth/consent`.
- **Expected:**
  - The consent page says "After you allow it, you go back to" `claude.ai` (or `chatgpt.com`), and lists what the assistant can do; **Allow** connects.
  - Both AI clients list Payleor's tools (`search_offerings`, `request_quote`, `list_my_projects`, `get_project`, `reply`, `request_changes`; `accept_quote` and `accept_delivery` as app-only) and show its widgets.
  - The client account is a Payleor account with a verified identity, used for every later request.
- **Edge cases:** a client who never connects can still use the web and email path.

### AGT-10: The client's AI searches listed offerings

- **Actor:** client · **Surface:** Claude or ChatGPT · **Delivered by:** C · **Status:** Walked through in Claude on staging (2026-10-20); ChatGPT checked for consent and the golden prompts (2026-10-21)
- **Preconditions:** AGT-09; walk-crew has active offerings, listed by default; another published team has unlisted one offering and one department ("List in AI assistants" off).
- **Steps:**
  1. [human] Ask the AI to find someone to design a logo for a bakery under $400 in 5 days.
- **Expected:**
  - The results come only from active, listed offerings of active teams, with the offering, price range, usual days and seller, in a carousel with **Request a quote** on each card.
  - Another seller's unlisted offering never appears, nor any offering in an unlisted department; draft and suspended sellers never appear.
  - Once run B adds the fulfilment type, each result says whether people, automation or both fulfil it (AGT-19).
- **Edge cases:** none.

### AGT-11: The client requests a quote from the AI

- **Actor:** client · **Surface:** Claude or ChatGPT, web, email · **Delivered by:** C · **Status:** Walked through in Claude on staging (2026-10-20); ChatGPT checked for consent and the golden prompts (2026-10-21)
- **Preconditions:** AGT-10.
- **Steps:**
  1. [human] Pick the walk-crew offering and ask the AI to request it, answering its intake questions.
- **Expected:**
  - A project in quoting appears on `{dash}/walk-crew/projects` and on the freelancers' `{dash}/walk-crew/requests` board, recording the AI as the client's home surface (`project.client_home_surface = mcp`) and the signed-in client as its contact (verified `user` and `email` identities).
  - The client also gets an email with the client page link (AI clients cannot receive pushes).
- **Edge cases:** today's request limits apply to the AI path too.

### AGT-12: The client accepts a quote with the widget button

- **Actor:** client · **Surface:** Claude or ChatGPT (quote widget) · **Delivered by:** C · **Status:** Walked through in Claude on staging (2026-10-20); ChatGPT checked for consent and the golden prompts (2026-10-21)
- **Preconditions:** the team sent a quote for the AGT-11 project.
- **Steps:**
  1. [human] Ask the AI for the project's status; the quote widget appears.
  2. [human] Press the widget's accept button.
- **Expected:**
  - The widget shows one slide per freelancer with the quote items and total; after **Accept quote** on a slide, that quote is accepted and the deposit payment exists, exactly as an acceptance on the client page.
  - The team's project page shows the quote accepted.
- **Edge cases:** see AGT-15 for what the model cannot do.

### AGT-13: The client pays from the widget on the pay page

- **Actor:** client, PayPal buyer · **Surface:** Claude or ChatGPT, web (pay page) · **Delivered by:** C · **Status:** Walked through in Claude on staging (2026-10-20); ChatGPT checked for consent and the golden prompts (2026-10-21)
- **Preconditions:** AGT-12.
- **Steps:**
  1. [human] Press **Pay $… with PayPal**; the AI client opens the pay page on `walk-crew.payleor.app/pay/{token}` (the card shows "Opens walk-crew.payleor.app").
  2. [human] Approve the payment in the PayPal popup as the PayPal buyer.
- **Expected:**
  - The pay page is the same one the web uses ([`04-payments.md`](04-payments.md)); the deposit is captured and the project starts.
  - Asking the AI for the status afterwards shows the deposit as paid.
- **Edge cases:** nothing in the AI can pay without the PayPal approval.

### AGT-14: The client accepts a delivery with the widget button and pays the balance

- **Actor:** client · **Surface:** Claude or ChatGPT (delivery widget), web (pay page) · **Delivered by:** C · **Status:** Walked through in Claude on staging (2026-10-20); ChatGPT checked for consent and the golden prompts (2026-10-21)
- **Preconditions:** the freelancer delivered the AGT-13 project on the web; the former `/deliver` path belongs to cancelled run E.
- **Steps:**
  1. [human] Ask the AI whether the logo is ready; the delivery widget appears.
  2. [human] Press the widget's accept delivery button, then pay the balance as in AGT-13.
- **Expected:**
  - The widget shows the delivery note, link or file.
  - The delivery is accepted, the balance is captured, and the project completes; the team's payout rules then pay the member (OUT-17).
- **Edge cases:** requesting changes from the widget follows the same rule as accepting.

### AGT-15: The model cannot accept on the client's behalf

- **Actor:** client's AI · **Surface:** Claude or ChatGPT · **Delivered by:** C · **Status:** Walked through in Claude on staging (2026-10-20); ChatGPT checked for consent and the golden prompts (2026-10-21)
- **Preconditions:** an open quote (AGT-12) or a delivery waiting (AGT-14).
- **Steps:**
  1. [human] Tell the AI to accept the quote (or the delivery) for you without pressing the widget button.
- **Expected:**
  - Nothing is accepted: the accept tools can be called only by the widget, so the model can at most show the widget.
  - The team's project page shows no change.
- **Edge cases:** none.

### AGT-31: The team asks the client a question and the client answers

- **Actor:** freelancer, client · **Surface:** web (`{dash}`, client page on `{seller}`), Claude or ChatGPT · **Delivered by:** C · **Status:** Walked through in Claude on staging (2026-10-20); ChatGPT checked for consent and the golden prompts (2026-10-21)
- **Preconditions:** AGT-11, a request to walk-crew in `open` mode.
- **Steps:**
  1. As an eligible freelancer, open the request from **Open requests**, write in the Request tab's message box, tick "Ask it as a question for the client" and **Send**.
  2. [human] Ask the AI client about the project; press **Answer in the chat** on the freelancer's slide and approve the answer the AI drafts (it calls `reply` with the question id).
  3. Ask a second question; answer it on the client page at `{seller}/c/{token}` in the **Responses** section ("Your answer", **Send answer**).
- **Expected:**
  - Each question shows the asking freelancer; each answer appears under its question on the team's request, in the plugin card and on the client page.
  - The client never reads the request space itself: their answers arrive in it as "Client".
- **Edge cases:** a team member holding the client link cannot answer as the client (AGT-04).

### AGT-32: Contact details are hidden until a quote is accepted

- **Actor:** freelancer, client · **Surface:** web, Claude or ChatGPT · **Delivered by:** C · **Status:** Walked through in Claude on staging (2026-10-20); ChatGPT checked for consent and the golden prompts (2026-10-21)
- **Preconditions:** AGT-31.
- **Steps:**
  1. Before any quote is accepted, post a message with an email address, a phone number, a WhatsApp link and a file link, as the freelancer and as the client.
  2. Accept a quote (AGT-12), then post the same message again.
- **Expected:**
  - Before acceptance, the email, phone number and messaging link read "[hidden until a quote is accepted]" on every surface; the file link stays.
  - After acceptance, messages show as written.
  - DB check (developer): the message keeps the original body for admins.
- **Edge cases:** none.

### AGT-33: The seller declines a request with a reason

- **Actor:** team admin, client · **Surface:** web (`{dash}`), Claude or ChatGPT, client page · **Delivered by:** C · **Status:** Walked through in Claude on staging (2026-10-20); ChatGPT checked for consent and the golden prompts (2026-10-21)
- **Preconditions:** a new request to walk-crew from the AI (AGT-11).
- **Steps:**
  1. As staff, on the project page's Conversation section, use "Decline the request": press **Decline request** once with the reason empty, then with a reason.
  2. [human] Ask the AI client about the request.
- **Expected:**
  - Without a reason: "Say why you are declining; the client reads it." With one, the project shows as Declined with "Declined: {reason}" on `{dash}`.
  - The plugin card shows "The team declined this request.", the reason and **Search again**; the client page shows "The team declined this request", the reason and **Send a new request**, and its message box is gone.
- **Edge cases:** a freelancer cannot decline; a declined request cannot be quoted.

### AGT-34: The client compares competing quotes from one team

- **Actor:** freelancers, client · **Surface:** Claude or ChatGPT, client page · **Delivered by:** C · **Status:** Walked through in Claude on staging (2026-10-20); ChatGPT checked for consent and the golden prompts (2026-10-21)
- **Preconditions:** walk-crew in `open` mode with two or more freelancers in the offering's department; a new request from the AI (AGT-11).
- **Steps:**
  1. Two freelancers each send a quote on the request.
  2. [human] Ask the AI to show the quotes, then accept one with its widget button.
- **Expected:**
  - The card shows one slide per freelancer, each with that freelancer's quote and questions; the client page groups them the same way.
  - Accepting one makes it the project's quote; the request space closes to the other freelancers, and the winner joins the project space with the request history.
- **Edge cases:** in `team` mode freelancers discuss but only staff quote; a staff shortlist replaces the department rule.

### AGT-35: The client sees all their projects across teams

- **Actor:** client · **Surface:** web (`{dash}/me/projects`) · **Delivered by:** C · **Status:** Walked through in Claude on staging (2026-10-20); ChatGPT checked for consent and the golden prompts (2026-10-21)
- **Preconditions:** the client account from AGT-09 holds projects with two teams.
- **Steps:**
  1. Sign in on `{dash}` as the client and open **Your projects as a client** in the user menu (`{dash}/me/projects`). The page lives on the dashboard host because the session cookie does not reach `{site}`.
- **Expected:**
  - The page lists each project with its title, team and status, each linking to that team's client page on `{seller}`.
- **Edge cases:** a project of a team the person belongs to is not listed as theirs (a team member is never the client).

### AGT-36: Client and pay pages live on the team's own site

- **Actor:** client · **Surface:** web (`{seller}`) · **Delivered by:** C · **Status:** Partly walked through (2026-10-20): old links redirect; another team's host is untested on staging
- **Preconditions:** a walk-crew project with a client link and a pay link.
- **Steps:**
  1. Open the client link and the pay link from the client email.
  2. Open the same token paths on another team's subdomain, and an old client link on the site host.
- **Expected:**
  - The pages open on `walk-crew.payleor.app` (`/c/{token}`, `/pay/{token}`).
  - On another team's subdomain they are not found; the old site URL redirects to the team's site.
- **Edge cases:** none.

## B1: operating model, notices and engine

[Staging evidence, per-story remaining edges](../platform/plans/2026-10-27-b1-staging-walkthrough.md) is authoritative: “Built on branch” does not mean every Expected/Edge case below passed live. In particular, AI-home notice coverage, ChatGPT card refresh, balance checkout, payout refusal during a dispute, abandon/cancellation and other edges retain that report's limits.

Plan: [`2026-10-22-b1-operating-model.md`](../platform/plans/2026-10-22-b1-operating-model.md), Task 10; design: [`2026-10-21-b1-operating-model-design.md`](../platform/2026-10-21-b1-operating-model-design.md).

### AGT-16: Client notices go to the client's home surface

- **Actor:** client · **Surface:** email · **Delivered by:** B1 · **Status:** Built on branch (B1; staging observations 2026-10-27, not merged or production-verified)
- **Preconditions:** projects whose client's home is web and email, and one whose home is the AI.
- **Steps:**
  1. Send a quote, request a payment and submit a delivery on each project.
- **Expected:**
  - Each event that needs the client sends one email notice to the client with the client page link; AI-home clients get the same emails.
  - A notice that fails to send is retried by the cron and is not sent twice.
- **Edge cases:** the Discord-notice case is deferred (E cancelled); it is not a required current path.

### AGT-19: Offerings say how they are fulfilled

- **Actor:** team admin, client · **Surface:** web (`{dash}`, `{seller}`), plugin · **Delivered by:** B1 · **Status:** Built on branch (B1; staging observations 2026-10-27, not merged or production-verified)
- **Preconditions:** walk-crew services.
- **Steps:**
  1. Set an offering's fulfilment type (by people, automated, or both).
  2. Open the seller page; search for it through the plugin (AGT-10).
- **Expected:**
  - The seller page and the plugin results show the fulfilment type on each offering.
- **Edge cases:** none.

### AGT-37: A request the seller does not act on within 48 hours expires

- **Actor:** team admin, client · **Surface:** web, email, Claude or ChatGPT · **Delivered by:** B1 · **Status:** Built on branch (B1; staging observations 2026-10-27, not merged or production-verified)
- **Preconditions:** a new request to walk-crew; the deadline shortened for the walkthrough, or a request backdated (DB check (developer)).
- **Steps:**
  1. Leave the request without a quote, question or decline past the reminder time, then past the deadline.
- **Expected:**
  - The team gets a reminder before the deadline.
  - At the deadline the request shows as expired on `{dash}`, the client page and the plugin card, and the client is told by email.
- **Edge cases:** a question or a decline counts as acting; an expired request cannot be quoted.

### AGT-46: A team edits and publishes its operating rules

- **Actor:** team admin · **Surface:** web (`{dash}/walk-crew/rules`) · **Delivered by:** B1 · **Status:** Built on branch (B1; staging observations 2026-10-27, not merged or production-verified)
- **Preconditions:** walk-crew with an existing project pinned to rulebook v1.
- **Steps:**
  1. Open the team's Rules page, edit a rule (such as free revisions or upfront rate), preview the client terms and member agreement summaries, and publish a new version.
  2. Start or receive a new request.
- **Expected:**
  - Publishing creates rulebook v2; the new request pins v2, while the existing project stays on v1.
- **Edge cases:** editing a draft does not affect new or running projects until published.

### AGT-47: Client and member accept the current rules before working together

- **Actor:** client, team member · **Surface:** web (`{seller}`, `{dash}`) · **Delivered by:** B1 · **Status:** Built on branch (B1; staging observations 2026-10-27, not merged or production-verified)
- **Preconditions:** AGT-46.
- **Steps:**
  1. On the seller quote request form, read the client terms summary and submit a request after checking the agreement box.
  2. Sign in on `{dash}` as a team member after a new rulebook version was published, accept the member agreement, and toggle **Email me about my projects**.
- **Expected:**
  - Both acceptances are recorded against the published rulebook version (`rulebook_acceptance`).
  - When a member turns project emails off, team notices for their projects are skipped (`outbox_delivery` marked `skipped`).
- **Edge cases:** submitting the request form without accepting the terms is refused.

### AGT-48: Upfront payment rules set the deposit or full payment

- **Actor:** team admin, client · **Surface:** web (`{dash}`, `{seller}` pay page) · **Delivered by:** B1 · **Status:** Built on branch (B1; staging observations 2026-10-27, not merged or production-verified)
- **Preconditions:** walk-crew with tiered upfront rules (`< $300` -> `100% upfront`, `>= $1,000` -> `50% upfront`).
- **Steps:**
  1. Send and accept a `$200` quote on one project and a `$1,200` quote on another.
  2. Open each pay link, pay the upfront invoice, deliver, and accept the delivery.
- **Expected:**
  - The `$200` quote collects 100% up front (plus the management fee) and completes immediately when the delivery is accepted without a second payment step.
  - The `$1,200` quote collects a 50% deposit up front and moves to `awaiting_balance` when the delivery is accepted.
- **Edge cases:** the upfront rate is locked when the quote is accepted.

### AGT-49: Free revisions stop at the limit and offer a paid revision amendment

- **Actor:** client, team admin · **Surface:** web (client page, `{dash}`) · **Delivered by:** B1 · **Status:** Built on branch (B1; staging observations 2026-10-27, not merged or production-verified)
- **Preconditions:** an in-progress project with 1 free revision.
- **Steps:**
  1. Submit a delivery, request changes once as the client, deliver again, and try to request changes a second time.
  2. Propose and accept the pre-filled paid revision amendment.
- **Expected:**
  - The first revision request succeeds; the second is refused because the free revision limit is reached, pointing to a paid revision amendment pre-filled with the rulebook's revision price.
- **Edge cases:** once the paid revision amendment is accepted and topped up, the client can request changes again.

### AGT-50: Late delivery records a refund proposal the admin confirms or waives

- **Actor:** freelancer, team admin · **Surface:** web (`{dash}`) · **Delivered by:** B1 · **Status:** Built on branch (B1; staging observations 2026-10-27, not merged or production-verified)
- **Preconditions:** an in-progress project past its `deadlineAt` under a rulebook with a late-delivery rate (for example 2%/day capped at 20%).
- **Steps:**
  1. Submit the delivery after the deadline.
  2. As the team admin, open the project page and confirm (or waive) the proposed late-delivery refund.
- **Expected:**
  - Submitting late records a pending late-delivery refund proposal on the project without moving money automatically.
  - Confirming the proposal applies the refund/reduction and adjusts the member's share; waiving clears it without moving money.
- **Edge cases:** on-time deliveries or rulebooks with 0%/day record no proposal.

### AGT-51: Missed member updates remind the member and record a mark

- **Actor:** freelancer, team admin · **Surface:** web (`{dash}`), email · **Delivered by:** B1 · **Status:** Built on branch (B1; staging observations 2026-10-27, not merged or production-verified)
- **Preconditions:** an in-progress project whose update window has elapsed without a message or delivery (DB check (developer)).
- **Steps:**
  1. Run the scheduler sweep past the reminder time, then past the update deadline.
  2. Repeat or seed marks to reach the rulebook's strike threshold, and test giving leaving notice.
- **Expected:**
  - The member receives an update reminder before the deadline, and a `late_update` mark is recorded when the window expires.
  - Reaching the strike threshold records a warning/strike and alerts the team admins; giving leaving notice records the notice window.
- **Edge cases:** posting a message or submitting a delivery resets the update window.

### AGT-52: Client silence follows the team's ladder (accept and complete, or abandon)

- **Actor:** client, system scheduler · **Surface:** web, email · **Delivered by:** B1 · **Status:** Built on branch (B1; staging observations 2026-10-27, not merged or production-verified)
- **Preconditions:** a delivered project where the client has not accepted or requested changes past the silence ladder's reminder and final days (DB check (developer)).
- **Steps:**
  1. Run the scheduler sweep at the first reminder, second reminder, and final close day.
- **Expected:**
  - The client receives the silence reminders by email.
  - At the final day, a fully paid project auto-completes (`completed`) and settles the ledger split; if the rulebook's unpaid-balance silence outcome is `abandon` (or balance remains unpaid under `abandon`), the project moves to `abandoned`.
- **Edge cases:** any client reply or change request cancels the silence ladder.

### AGT-53: Quality refunds respect the rulebook's caps

- **Actor:** team admin · **Surface:** web (`{dash}`) · **Delivered by:** B1 · **Status:** Built on branch (B1; staging observations 2026-10-27, not merged or production-verified)
- **Preconditions:** a paid project in progress or delivered, under a rulebook with quality refund caps (for example 50% in progress, 25% after delivery).
- **Steps:**
  1. Attempt to issue a quality refund above the phase cap, then within the cap.
- **Expected:**
  - A refund above the rulebook's cap for the current project phase is refused; a refund within the cap succeeds.
- **Edge cases:** full cancellation before work starts allows up to the before-work cap (100%).

### AGT-54: A PayPal dispute pauses the project's timers and payouts

- **Actor:** PayPal webhook, team admin · **Surface:** webhooks, web (`{dash}`), email · **Delivered by:** B1 · **Status:** Built on branch (B1; staging observations 2026-10-27, not merged or production-verified)
- **Preconditions:** a paid project with a captured PayPal payment.
- **Steps:**
  1. Send a signed or simulated `CUSTOMER.DISPUTE.CREATED` webhook for the capture, then `CUSTOMER.DISPUTE.RESOLVED`.
- **Expected:**
  - Opening the dispute records a `dispute` row, pauses the project's scheduled timers (`schedule_item`), holds payouts for the project, and emails `disputes@` and the team admins.
  - Resolving the dispute in the seller's favour resumes the timers and unblocks payouts.
- **Edge cases:** duplicate webhook deliveries for the same dispute ID are idempotent.

## B2: API, webhooks and seller tools

Plan: not written.

### AGT-17: A team creates an API key with explicit permissions

- **Actor:** team admin · **Surface:** web, public API · **Delivered by:** B2 · **Status:** Planned (B2)
- **Preconditions:** walk-crew.
- **Steps:**
  1. Create an API key with only the permissions to read projects and send quotes.
  2. Call the API with it to list projects and send a quote; then to refund a client.
  3. Call the API with it to accept a quote.
  4. Revoke the key and call again.
- **Expected:**
  - The key is shown once; step 2's reads and quote work and match the web.
  - The refund is refused (the key lacks the permission); the acceptance is refused (an API key never acts as a client).
  - After revoking, every call is refused.
- **Edge cases:** every API call is recorded in the action log with the key as the actor.

### AGT-18: A team receives signed webhooks

- **Actor:** team's own system · **Surface:** webhooks · **Delivered by:** B2 · **Status:** Planned (B2)
- **Preconditions:** walk-crew registers a webhook endpoint the tester can read.
- **Steps:**
  1. Move a project through quote, payment and delivery, and let a payout settle.
  2. Check each delivery's signature with the team's signing secret.
- **Expected:**
  - Project events and payout events arrive at the endpoint, each signed; the signature checks out, and a tampered body fails it.
  - A delivery the endpoint refuses is retried later.
- **Edge cases:** none.

## M: the mall

Plan: not written.

### AGT-38: The client's AI finds products across stores

- **Actor:** client · **Surface:** Claude or ChatGPT · **Delivered by:** M · **Status:** Cancelled for this delivery (2026-10-27)
- **Preconditions:** AGT-09; two published stores with listed physical and digital products, one with variants and limited stock.
- **Steps:**
  1. [human] Ask the AI for a product both stores sell, then for one product's details.
- **Expected:**
  - Results come from both stores, each with store, price and stock; the details show variants and stock.
- **Edge cases:** draft and out-of-stock products are marked or left out as the run's plan settles.

### AGT-39: The client fills one cart across stores

- **Actor:** client · **Surface:** Claude or ChatGPT · **Delivered by:** M · **Status:** Cancelled for this delivery (2026-10-27)
- **Preconditions:** AGT-38.
- **Steps:**
  1. [human] Ask the AI to add a product from each store, then to show the cart.
- **Expected:**
  - The cart card lists the items by store with prices, shipping and the total; the cart is kept on Payleor for the signed-in client.
- **Edge cases:** adding more than the stock is refused.

### AGT-40: One PayPal checkout pays every store in the cart

- **Actor:** client · **Surface:** Claude or ChatGPT, web (checkout on `payleor.app`) · **Delivered by:** M · **Status:** Cancelled for this delivery (2026-10-27)
- **Preconditions:** AGT-39.
- **Steps:**
  1. [human] Press **Checkout** on the cart card; on Payleor's checkout, approve in the PayPal popup and give the shipping address there.
- **Expected:**
  - One PayPal order pays each store as its own payee, with each store's flat shipping and Payleor's fee.
  - Stock is reserved at checkout; each store sees its order.
- **Edge cases:** an item sold out since it was added is refused before payment. Cut order: one store per checkout if the multi-store order slips.

### AGT-41: A store ships an order with a tracking number

- **Actor:** store admin, client · **Surface:** web (`{dash}`) · **Delivered by:** M · **Status:** Cancelled for this delivery (2026-10-27)
- **Preconditions:** AGT-40.
- **Steps:**
  1. As the store admin, open the physical order and mark it shipped with a carrier and tracking number.
- **Expected:**
  - The order shows as shipped with the tracking number; the client sees it on their order.
  - DB check (developer): the tracking is sent to PayPal's tracking API for the capture.
- **Edge cases:** digital orders need no shipping.

## E: Discord

Plan: not written; design: [`2026-10-13-discord-ticket-flow-design.md`](../platform/2026-10-13-discord-ticket-flow-design.md), to revise first.

### AGT-20: The S2 Discord features work on a real server

- **Actor:** team admin, freelancer · **Surface:** Discord, web · **Delivered by:** E · **Status:** Cancelled for this delivery (2026-10-27)
- **Preconditions:** the Discord app pointed at the deployed hosts.
- **Steps:**
  1. Run DIS-01 to DIS-07 in [`08-discord.md`](08-discord.md).
- **Expected:**
  - Every DIS story passes and its status becomes Verified; fixes land before the rest of run E.
- **Edge cases:** none.

### AGT-21: A team with Discord gets a project channel for any project

- **Actor:** team admin, client · **Surface:** Discord, web · **Delivered by:** E · **Status:** Cancelled for this delivery (2026-10-27)
- **Preconditions:** AGT-20; walk-crew's server linked; one project whose client is on Discord and in the server, one whose client is not (for example started on the web or from the AI).
- **Steps:**
  1. Start or receive each project.
  2. [human] Look at the server as a team member and as the Discord client.
- **Expected:**
  - Each project gets its own private channel; the client is inside only when the client is on Discord, otherwise the channel is team-only.
  - People outside the project and the team's chosen role do not see the channel.
- **Edge cases:** Discord is never called inside a database transaction; a Discord outage delays the channel, which is created when Discord answers again.

### AGT-22: The pinned project card and notices follow the project

- **Actor:** team, client · **Surface:** Discord · **Delivered by:** E · **Status:** Cancelled for this delivery (2026-10-27)
- **Preconditions:** AGT-21.
- **Steps:**
  1. Move the project through quote, payment, delivery and acceptance on any surface.
  2. [human] Watch the project channel.
- **Expected:**
  - A pinned card always shows the current state, the quote, payments and the next step naming who acts.
  - Each event that needs someone posts a notice that mentions only that person; Payleor never pings everyone or a role.
- **Edge cases:** none.

### AGT-23: The freelancer delivers with /deliver

- **Actor:** freelancer · **Surface:** Discord · **Delivered by:** E · **Status:** Cancelled for this delivery (2026-10-27)
- **Preconditions:** AGT-21 with the deposit paid; the freelancer's Discord account linked (DIS-02).
- **Steps:**
  1. [human] In the project channel, run `/deliver` and submit a note, a link or a file.
- **Expected:**
  - The delivery appears on the project page and the client page exactly as a web delivery; the card and a notice update.
- **Edge cases:** running it outside a project channel, or as someone who may not deliver on the web, is refused with a reply only the caller sees.

### AGT-24: The Discord client acts with buttons, and only the client can

- **Actor:** client, team member · **Surface:** Discord · **Delivered by:** E · **Status:** Cancelled for this delivery (2026-10-27)
- **Preconditions:** AGT-21 with the client on Discord.
- **Steps:**
  1. [human] As the client, accept the quote on the card, follow the pay button to the pay page, and approve the payment in PayPal as the PayPal buyer.
  2. [human] As a team member, press the accept button on the next delivery.
  3. [human] As the client, accept the delivery (or request changes).
- **Expected:**
  - The client's presses accept and request changes exactly as the client page does; payment always happens on the pay page.
  - The team member's press is refused and changes nothing.
  - A press on an outdated card is refused and the card refreshes.
- **Edge cases:** this story is first in the cut order after the AI seller; the team side stays if it is cut.

### AGT-25: A person confirms an agent's draft from a Discord card

- **Actor:** team admin · **Surface:** Discord · **Delivered by:** E · **Status:** Cancelled for this delivery (2026-10-27)
- **Preconditions:** AGT-21; a draft proposal from the intake agent (AGT-26), or a seeded one until run D.
- **Steps:**
  1. [human] In the project channel, read the draft card and confirm it.
- **Expected:**
  - The quote is sent as if the admin had sent it on the web; the confirmation records the admin as the confirmer.
  - A Discord user who lacks the quoting grant cannot confirm it.
- **Edge cases:** the agent itself never confirms.

### AGT-42: The client and the team's freelancers talk in a Discord request thread

- **Actor:** client, freelancers · **Surface:** Discord, web · **Delivered by:** E · **Status:** Cancelled for this delivery (2026-10-27)
- **Preconditions:** AGT-20; a request from a client on the team's Discord server.
- **Steps:**
  1. [human] Post in the request's channel or thread as the client and as an eligible freelancer.
  2. Accept one freelancer's quote.
- **Expected:**
  - Messages in the thread and on the web request stay in sync, with the same audience and masking as AGT-31 and AGT-32.
  - Acceptance opens a private project channel with that freelancer (AGT-21), and the project's messages sync there.
- **Edge cases:** cut order: the request-thread sync goes before the private project channel.

## D: one contextual agent

Plan: not written.

### AGT-26: Payleor prepares an intake proposal in the request's context

- **Actor:** team admin and Payleor acting for that admin · **Surface:** contextual dash · **Delivered by:** D / contextual agent · **Status:** Planned (D)
- **Preconditions:** a new request from the web or client plugin; the section is in Ask me and the admin has the quoting grant.
- **Steps:** open the request's call, inspect the drafted question or quote, edit it, then confirm.
- **Expected:** the same agent uses this request's authorized records and pinned rulebook; a proposal is visibly distinct from a sent quote. Nothing reaches the client until an authorized person confirms through `perform`; the resulting event refreshes the call and record.
- **Edge cases:** untrusted client text cannot grant a tool or expand scope; Manual prepares nothing automatically. Auto behavior needs a separately approved rule/limit. Discord confirmation is outside this delivery (E cancelled).

### AGT-27: The team sees its analytics in AG Studio

- **Actor:** team admin · **Surface:** web (dashboard) · **Delivered by:** D · **Status:** Cancelled for this delivery (2026-10-27)
- **Preconditions:** walk-crew with paid projects and settled payouts.
- **Steps:**
  1. Open the team's analytics page.
- **Expected:**
  - AG Studio shows custom widgets for the money flow, payouts, and work done by agents and by people, with numbers that match the ledger.
- **Edge cases:** members see only what their role allows.

### AGT-28: The contextual agent answers about the team's money

- **Actor:** team admin · **Surface:** contextual dash · **Delivered by:** D / contextual agent · **Status:** Planned (D)
- **Preconditions:** paid projects and settled payouts in a workspace the admin may access; no AG Studio dependency.
- **Steps:** ask “What did we make this week?” in that workspace, then open a supporting project or payout.
- **Expected:** the answer uses authorized ledger/business records with an explicit time range and links to its evidence. A chart or table may be shown in the call; it is the same scoped agent, not another analytics persona. Asking a read question moves no money.
- **Edge cases:** a member cannot obtain other members' or another team's private results by attaching a record or quoting an identifier; unsupported figures are reported as unavailable.

## P: reputation and profiles

Plan: not written.

### AGT-43: Client and seller rate each other after a completed project

- **Actor:** client, team admin · **Surface:** web (client page, `{dash}`), Claude or ChatGPT · **Delivered by:** P · **Status:** Planned (P)
- **Preconditions:** a paid, completed walk-crew project (DEL stories).
- **Steps:**
  1. [human] As the client, rate the seller in stars and write a review.
  2. As the team admin, rate the client.
- **Expected:**
  - Both ratings are saved; the client's review is public on the seller's profile.
- **Edge cases:** a project that is unpaid, cancelled or not completed cannot be rated.

### AGT-44: The seller page shows a profile with ratings, reviews and portfolio

- **Actor:** team admin, visitor · **Surface:** web (`{dash}`, `{seller}`) · **Delivered by:** P · **Status:** Planned (P)
- **Preconditions:** AGT-43.
- **Steps:**
  1. As the team admin, add a portfolio item.
  2. Open the seller page as a visitor.
- **Expected:**
  - The seller page shows the average rating, the public reviews and the portfolio.
- **Edge cases:** cut order: the portfolio goes before ratings and reviews.

### AGT-45: Offering cards in the AI show the seller's rating

- **Actor:** client · **Surface:** Claude or ChatGPT · **Delivered by:** P · **Status:** Planned (P)
- **Preconditions:** AGT-43, AGT-10.
- **Steps:**
  1. [human] Search for an offering of walk-crew in the AI.
- **Expected:**
  - The offering card shows the seller's star rating and number of reviews.
- **Edge cases:** a seller with no ratings shows none, not zero stars.

## Optional: the AI seller

Plan: not written.

### AGT-29: An AI seller quotes and delivers at once through the public API

- **Actor:** AI seller (a separate Worker), client · **Surface:** plugin, public API, webhooks, pay page · **Delivered by:** AI seller · **Status:** Planned (AI seller)
- **Preconditions:** the AI seller is a listed team with an automated offering, an API key (AGT-17) and a webhook (AGT-18).
- **Steps:**
  1. [human] In the AI client, find the AI seller's offering (AGT-10) and request it.
  2. [human] Accept the fixed-price quote with the widget button and pay on the pay page as the PayPal buyer.
- **Expected:**
  - The AI seller quotes its fixed price through the API as soon as the request webhook arrives, and delivers an image as soon as the payment is captured.
  - The client sees the delivery in the widget and accepts it with the button; the team's payout rules apply as for any team.
- **Edge cases:** first in the cut order.

## Freeze: the demo

Oct 31, on the deployed hosts.

### AGT-30: The retained PayPal demo runs end to end on the deployed hosts

- **Actor:** client, team admin, freelancer · **Surface:** client plugin, web dash/client/pay pages · **Delivered by:** Freeze · **Status:** Planned (Freeze)
- **Preconditions:** B1 merged and deployed; reviewed demo seed, sandbox accounts, and retained feature plans complete. This is separate from the Meta build-window demo.
- **Steps:** find a service in the plugin, request it, have the team quote on the web, accept with the client's widget, [human] approve PayPal payment, deliver on the web, accept/pay any balance, then verify the member's payout and business history.
- **Expected:** each step agrees across surfaces, the business rules explain holds and next actions, and payer approval stays in PayPal. M, E and AG Studio are not required or claimed.
- **Edge cases:** record remaining coverage explicitly; never substitute a mockup for deployed agent/runtime evidence.

## Contextual agent: planned walkthroughs

Plan: not written. Design: [Calls and the agent](../platform/2026-10-27-calls-and-agent-design.md). These stories test a future implementation, not the static HTML mocks.

### AGT-55: The agent's environment follows the authorized context

- **Actor:** account owner, admin and restricted member · **Surface:** contextual dash · **Delivered by:** D / contextual agent · **Status:** Planned (D)
- **Preconditions:** accounts with separate workspaces and a restricted project member.
- **Steps:** start at account level, enter a workspace, then a project; inspect each level's available records/actions.
- **Expected:** the same agent follows account → workspace → section → record; account summaries do not grant cross-team detail access. Every read and transition is filtered by actor grants and record ACL.
- **Edge cases:** direct IDs, one-link records and model-generated links cannot reveal an unauthorized record.

### AGT-56: Events route and batch calls without duplicating business state

- **Actor:** admin and Payleor · **Surface:** contextual dash · **Delivered by:** D / contextual agent · **Status:** Planned (D)
- **Preconditions:** explicit routing rules, payout requests and a held request.
- **Steps:** request two eligible payouts, replay an event, and add a held request.
- **Expected:** eligible requests join the intended batch/call once; requested, eligible and held totals are distinct. Needs you / In progress / Done derive from the same current record state and actor, not independent mock counts.
- **Edge cases:** duplicate delivery cannot duplicate a call/action; a follow-up and a resolved hold refresh the existing call. Exercise a two-approver preset: the first approval stays Needs you for the remaining eligible approver, full approval/queued send and sent state are In progress, and settlement is Done. Optional permitted actions do not create a required wait or close a call.

### AGT-57: Modes gate preparation and execution

- **Actor:** authorized admin and Payleor · **Surface:** contextual dash · **Delivered by:** D / contextual agent · **Status:** Planned (D)
- **Preconditions:** approved mode-change behavior and an explicit Auto action allowlist/limit; a forbidden action and over-limit case.
- **Steps:** exercise the same request in Manual, Ask me and Auto, then retry without the required role.
- **Expected:** Manual waits for the person; Ask me prepares but does not execute; Auto executes only a rule-authorized eligible transition and logs its actor/rule/version. Forbidden and over-limit actions require the defined human path. Checkout still needs the payer's PayPal approval.
- **Edge cases:** changing mode or wording a prompt cannot grant a permission or commit as the client. Attempt `project.refund_client` (agent policy `never`) in every mode: it remains refused for the agent, with human execution required. Repeat Ask me with an existing Automatic payout preset: deterministic scheduled sends continue under that preset and are disclosed; the agent's new discretionary action still requires confirmation. No mode-suspends-engine behavior is assumed.

### AGT-58: Stale widgets cannot bypass a transition guard

- **Actor:** admin and Payleor · **Surface:** contextual dash/API action boundary · **Delivered by:** D / contextual agent · **Status:** Planned (D)
- **Preconditions:** a payout approval card, then a hold or state change before it is pressed.
- **Steps:** open the card, change the underlying state, and attempt its action; repeat/retry the accepted action.
- **Expected:** `perform` rechecks state, ACL and pinned rules at execution. A stale action is refused with the current reason; a retry cannot pay twice. Tools/widgets and the call refresh from the resulting business event.
- **Edge cases:** a model-supplied action name, role or amount never replaces the server's check. Revoke a role or delegated grant after preparation and before execution; refuse the stale action. Exercise a batch spanning pinned versions only after its policy precedence is specified; unresolved combinations fail closed.

### AGT-59: Browsing and context composition preserve the call

- **Actor:** team admin · **Surface:** contextual dash · **Delivered by:** D / contextual agent · **Status:** Planned (D)
- **Preconditions:** an open call, an authorized project and a table with a selection.
- **Steps:** browse/search records, bring one into the call, return to the call, and reopen it later.
- **Expected:** browsing alone opens no call; the draft and selected context survive the defined navigation/resume flow. Bringing in a record displays the widened environment and reason; attached context widens relevance, never authority. A real multiline composer and filters work with the keyboard.
- **Edge cases:** reject an unauthorized attachment; after persisting a call, revoke workspace membership or a record grant and resume it. Re-resolve scope and strip/refuse inaccessible context and actions before any retrieval or execution. Empty selection and narrow screens remain usable without forcing all information into one screen.

### AGT-60: The Meta demo proves newly built contextual-agent work

- **Actor:** team admin and Payleor · **Surface:** deployed contextual dash · **Delivered by:** D / Meta demo · **Status:** Planned (D)
- **Preconditions:** implemented runtime using the selected Meta model, approved scope/Auto limits and a documented Oct 27–Nov 4 build-window change set.
- **Steps:** show an event-driven call, the prepared action, context composition, authorized confirmation and the refreshed outcome; contrast an eligible payout with a held one, then an intake proposal in the same agent.
- **Expected:** video and evidence distinguish pre-existing PayPal/B1 foundations from new agentic work. Actual model/tool use, business transitions, rule/permission enforcement and the action log are observable; static mockups are not presented as implemented behavior.
- **Edge cases:** if Auto is not implemented/verified, do not claim it; record the missing coverage rather than scripting a fake outcome.

### AGT-61: A customer works from My purchases

- **Actor:** verified customer with no seller · **Surface:** contextual dash · **Delivered by:** D / contextual agent · **Status:** Planned (D)
- **Steps:** open Personal, view purchases from two sellers, ask what needs a decision, then use the explicit client acceptance/payment path.
- **Expected:** own projects and permitted fields only; no seller setup, staff notes, member earnings or payout approval. Guest orders remain link-only until verified claiming exists. Existing no-account links retain their narrow grants.
- **Edge cases:** matching a typed email never imports another buyer's order. Personal seller collaboration does not share private purchases.

### AGT-62: One consultant buys, sells and works in different contexts

- **Actor:** consultant owning a solo seller, assigned/bidding in two teams and buying from a third · **Surface:** contextual dash · **Delivered by:** D / contextual agent · **Status:** Planned (D)
- **Steps:** switch between My purchases, solo Projects and team My work/Earnings; prepare a draft, switch context and return.
- **Expected:** one agent, each capacity's operating-model permissions and record relationships; only own bids/earnings as a worker, no team assignment or payouts in solo mode. Sender and audience remain attached to the original draft.
- **Edge cases:** deny rival quotes, private counts and cross-seller grant pooling before retrieval. Downgrade/revoke membership and resume: inaccessible context and derived summaries are removed or sealed.

### AGT-63: The same agent helps with a store order exception

- **Actor:** store operator and the order's customer · **Surface:** contextual dash/order page · **Delivered by:** D / contextual agent · **Status:** Planned (D)
- **Steps:** inspect a paid digital order whose notice failed, review a resend to its exact recipient, then inspect valid/expired download access and a refund.
- **Expected:** customer and operator see their respective authorized projections; reading uses no download allowance. Resend respects its existing action, refund stays human and revokes grants under existing behavior. No invented shipping, mall cart or service-delivery transitions.
- **Edge cases:** guest email is not proof of order ownership; retries use the original effect identity. An agency/studio enabling both capabilities keeps order and project relationships distinct.
