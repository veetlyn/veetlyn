# Agentic surfaces (AGT)

Planned stories for the agentic surfaces program (`../platform/2026-10-13-agentic-surfaces-program.md`) and the action registry and client contacts design (`../platform/2026-10-13-action-catalog-design.md`). Each run's walkthrough checks its stories here; the run's plan may sharpen a story (exact texts, pages) when it builds it, and then quotes UI text from the code. Run A1 changes nothing a person can see, so its proof is the existing story book passing unchanged.

Security rules every story here assumes (program §3.4):

- A member of the project's team is never its client, whatever link, contact or email they hold.
- Only identities Payleor verified count: an email whose link was clicked, a Discord user who interacted, a signed-in account.
- Agents read and draft; a person with the right grant confirms anything that commits the team or the client or moves money. An API key never acts as a client.
- Accepting a quote or a delivery from an AI client needs a press on a Payleor widget button.
- Every payment needs the payer's PayPal approval on the pay page.

## A2: client contacts

### AGT-01: The team manages a project's clients in a Clients section

- **Actor:** team admin · **Surface:** web (`{dash}/walk-crew/projects/{id}`) · **Delivered by:** A2 · **Status:** Planned (A2)
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

- **Actor:** team admin, client · **Surface:** web, email · **Delivered by:** A2 · **Status:** Planned (A2)
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

- **Actor:** team admin, freelancer · **Surface:** web · **Delivered by:** A2 · **Status:** Planned (A2)
- **Preconditions:** a project with a sent quote.
- **Steps:**
  1. On the project page, choose preview as client.
- **Expected:**
  - The client page shows read-only: the quote and payment state as the client sees them, with no action that accepts, pays or requests changes.
  - The team's project view returns no client link anywhere.
- **Edge cases:** none.

### AGT-04: A team member holding a client link is refused as the client

- **Actor:** freelancer · **Surface:** web (client page) · **Delivered by:** A2 · **Status:** Planned (A2)
- **Preconditions:** the assigned freelancer of a walk-crew project holds a valid client link for it (for example a link issued before A2, or a contact whose email is the freelancer's own).
- **Steps:**
  1. Signed in as the freelancer, open the client link and try to accept the quote.
  2. Try to accept a delivery the same way.
- **Expected:**
  - Both are refused and nothing changes; the action log records the refusal.
- **Edge cases:** a signed-in member whose verified account email matches a verified client email of the project is refused too.

### AGT-05: Unverified identities give no authority

- **Actor:** anonymous requester · **Surface:** web (`{seller}/request`) · **Delivered by:** A2 · **Status:** Planned (A2)
- **Preconditions:** a client whose email is verified on a walk-crew project.
- **Steps:**
  1. Without that inbox, submit a quote request on the walk-crew seller page with that client's email.
- **Expected:**
  - The request creates a new contact with an unverified email; the existing client's projects stay out of reach for the requester.
  - The link for the new request goes only to that email address.
- **Edge cases:** today's request limits still apply (per IP, per email per hour, three open requests per email per team).

### AGT-06: Client links sent before A2 keep working

- **Actor:** client · **Surface:** web (client page) · **Delivered by:** A2 · **Status:** Planned (A2)
- **Preconditions:** a project created and emailed before A2 (the migration turned its client into a contact).
- **Steps:**
  1. Open the old client link from the old email.
- **Expected:**
  - The client page opens and acts for the project's primary contact; that contact's email becomes verified.
- **Edge cases:** once the team reissues the link or removes the contact, the old link stops working.

## H: hosts and first deploy

### AGT-07: The platform runs on the deployed sandbox hosts

- **Actor:** team admin, client · **Surface:** web (`{site}`, `{dash}`, `{seller}`) · **Delivered by:** H · **Status:** Planned (H)
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

- **Actor:** team admin · **Surface:** PayPal consent screens · **Delivered by:** H · **Status:** Planned (H)
- **Preconditions:** AGT-07.
- **Steps:**
  1. Start turning on automatic payouts (OUT-04).
  2. [human] Read the PayPal consent screen.
- **Expected:**
  - PayPal names the app Payleor (no longer "Test Store").
- **Edge cases:** none.

## C: client's AI plugin

### AGT-09: A client connects the Payleor plugin in Claude and ChatGPT

- **Actor:** client · **Surface:** Claude, ChatGPT · **Delivered by:** C · **Status:** Planned (C)
- **Preconditions:** the plugin deployed on the platform hosts.
- **Steps:**
  1. [human] Add the Payleor connector in Claude, then in ChatGPT.
  2. [human] Sign in to a Payleor client account through the OAuth screen.
- **Expected:**
  - Both AI clients list Payleor's tools and show its widgets.
  - The client account is a Payleor account with a verified identity, used for every later request.
- **Edge cases:** a client who never connects can still use the web and email path.

### AGT-10: The client's AI searches listed offerings

- **Actor:** client · **Surface:** Claude or ChatGPT · **Delivered by:** C · **Status:** Planned (C)
- **Preconditions:** AGT-09; walk-crew has opted in to listing and has active services; another published team has not opted in.
- **Steps:**
  1. [human] Ask the AI to find someone to design a logo for a bakery under $400 in 5 days.
- **Expected:**
  - The results come only from sellers who chose to be listed, with the offering, price range, usual days and seller; draft, suspended and unlisted sellers never appear.
  - Once run B adds the fulfilment type, each result says whether people, automation or both fulfil it (AGT-19).
- **Edge cases:** none.

### AGT-11: The client requests a quote from the AI

- **Actor:** client · **Surface:** Claude or ChatGPT, web, email · **Delivered by:** C · **Status:** Planned (C)
- **Preconditions:** AGT-10.
- **Steps:**
  1. [human] Pick the walk-crew offering and ask the AI to request it, answering its intake questions.
- **Expected:**
  - A project in quoting appears on `{dash}/walk-crew/projects`, recording the AI as the client's home surface and the signed-in client as its contact.
  - The client also gets an email with the client page link (AI clients cannot receive pushes).
- **Edge cases:** today's request limits apply to the AI path too.

### AGT-12: The client accepts a quote with the widget button

- **Actor:** client · **Surface:** Claude or ChatGPT (quote widget) · **Delivered by:** C · **Status:** Planned (C)
- **Preconditions:** the team sent a quote for the AGT-11 project.
- **Steps:**
  1. [human] Ask the AI for the project's status; the quote widget appears.
  2. [human] Press the widget's accept button.
- **Expected:**
  - The widget shows the quote items and total; after the press, the quote is accepted and the deposit payment exists, exactly as an acceptance on the client page.
  - The team's project page shows the quote accepted.
- **Edge cases:** see AGT-15 for what the model cannot do.

### AGT-13: The client pays from the widget on the pay page

- **Actor:** client, PayPal buyer · **Surface:** Claude or ChatGPT, web (pay page) · **Delivered by:** C · **Status:** Planned (C)
- **Preconditions:** AGT-12.
- **Steps:**
  1. [human] Press the widget's pay button; the AI client opens the Payleor pay page.
  2. [human] Approve the payment in the PayPal popup as the PayPal buyer.
- **Expected:**
  - The pay page is the same one the web uses ([`04-payments.md`](04-payments.md)); the deposit is captured and the project starts.
  - Asking the AI for the status afterwards shows the deposit as paid.
- **Edge cases:** nothing in the AI can pay without the PayPal approval.

### AGT-14: The client accepts a delivery with the widget button and pays the balance

- **Actor:** client · **Surface:** Claude or ChatGPT (delivery widget), web (pay page) · **Delivered by:** C · **Status:** Planned (C)
- **Preconditions:** the freelancer delivered the AGT-13 project (on the web, or with `/deliver` after run E).
- **Steps:**
  1. [human] Ask the AI whether the logo is ready; the delivery widget appears.
  2. [human] Press the widget's accept delivery button, then pay the balance as in AGT-13.
- **Expected:**
  - The widget shows the delivery note, link or file.
  - The delivery is accepted, the balance is captured, and the project completes; the team's payout rules then pay the member (OUT-17).
- **Edge cases:** requesting changes from the widget follows the same rule as accepting.

### AGT-15: The model cannot accept on the client's behalf

- **Actor:** client's AI · **Surface:** Claude or ChatGPT · **Delivered by:** C · **Status:** Planned (C)
- **Preconditions:** an open quote (AGT-12) or a delivery waiting (AGT-14).
- **Steps:**
  1. [human] Tell the AI to accept the quote (or the delivery) for you without pressing the widget button.
- **Expected:**
  - Nothing is accepted: the accept tools can be called only by the widget, so the model can at most show the widget.
  - The team's project page shows no change.
- **Edge cases:** none.

## B: delivery and API

### AGT-16: Client notices go to the client's home surface

- **Actor:** client · **Surface:** email · **Delivered by:** B · **Status:** Planned (B)
- **Preconditions:** projects whose client's home is web and email, and one whose home is the AI.
- **Steps:**
  1. Send a quote, request a payment and submit a delivery on each project.
- **Expected:**
  - Each event that needs the client sends one email notice to the client with the client page link; AI-home clients get the same emails.
  - A notice that fails to send is retried by the cron and is not sent twice.
- **Edge cases:** clients whose home is Discord get the notice in Discord after run E (AGT-21).

### AGT-17: A team creates an API key with explicit permissions

- **Actor:** team admin · **Surface:** web, public API · **Delivered by:** B · **Status:** Planned (B)
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

- **Actor:** team's own system · **Surface:** webhooks · **Delivered by:** B · **Status:** Planned (B)
- **Preconditions:** walk-crew registers a webhook endpoint the tester can read.
- **Steps:**
  1. Move a project through quote, payment and delivery, and let a payout settle.
  2. Check each delivery's signature with the team's signing secret.
- **Expected:**
  - Project events and payout events arrive at the endpoint, each signed; the signature checks out, and a tampered body fails it.
  - A delivery the endpoint refuses is retried later.
- **Edge cases:** none.

### AGT-19: Offerings say how they are fulfilled

- **Actor:** team admin, client · **Surface:** web (`{dash}`, `{seller}`), plugin · **Delivered by:** B · **Status:** Planned (B)
- **Preconditions:** walk-crew services.
- **Steps:**
  1. Set an offering's fulfilment type (by people, automated, or both).
  2. Open the seller page; search for it through the plugin (AGT-10).
- **Expected:**
  - The seller page and the plugin results show the fulfilment type on each offering.
- **Edge cases:** none.

## E: Discord

### AGT-20: The S2 Discord features work on a real server

- **Actor:** team admin, freelancer · **Surface:** Discord, web · **Delivered by:** E · **Status:** Planned (E)
- **Preconditions:** the Discord app pointed at the deployed hosts.
- **Steps:**
  1. Run DIS-01 to DIS-07 in [`08-discord.md`](08-discord.md).
- **Expected:**
  - Every DIS story passes and its status becomes Verified; fixes land before the rest of run E.
- **Edge cases:** none.

### AGT-21: A team with Discord gets a project channel for any project

- **Actor:** team admin, client · **Surface:** Discord, web · **Delivered by:** E · **Status:** Planned (E)
- **Preconditions:** AGT-20; walk-crew's server linked; one project whose client is on Discord and in the server, one whose client is not (for example started on the web or from the AI).
- **Steps:**
  1. Start or receive each project.
  2. [human] Look at the server as a team member and as the Discord client.
- **Expected:**
  - Each project gets its own private channel; the client is inside only when the client is on Discord, otherwise the channel is team-only.
  - People outside the project and the team's chosen role do not see the channel.
- **Edge cases:** Discord is never called inside a database transaction; a Discord outage delays the channel, which is created when Discord answers again.

### AGT-22: The pinned project card and notices follow the project

- **Actor:** team, client · **Surface:** Discord · **Delivered by:** E · **Status:** Planned (E)
- **Preconditions:** AGT-21.
- **Steps:**
  1. Move the project through quote, payment, delivery and acceptance on any surface.
  2. [human] Watch the project channel.
- **Expected:**
  - A pinned card always shows the current state, the quote, payments and the next step naming who acts.
  - Each event that needs someone posts a notice that mentions only that person; Payleor never pings everyone or a role.
- **Edge cases:** none.

### AGT-23: The freelancer delivers with /deliver

- **Actor:** freelancer · **Surface:** Discord · **Delivered by:** E · **Status:** Planned (E)
- **Preconditions:** AGT-21 with the deposit paid; the freelancer's Discord account linked (DIS-02).
- **Steps:**
  1. [human] In the project channel, run `/deliver` and submit a note, a link or a file.
- **Expected:**
  - The delivery appears on the project page and the client page exactly as a web delivery; the card and a notice update.
- **Edge cases:** running it outside a project channel, or as someone who may not deliver on the web, is refused with a reply only the caller sees.

### AGT-24: The Discord client acts with buttons, and only the client can

- **Actor:** client, team member · **Surface:** Discord · **Delivered by:** E · **Status:** Planned (E)
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

- **Actor:** team admin · **Surface:** Discord · **Delivered by:** E · **Status:** Planned (E)
- **Preconditions:** AGT-21; a draft proposal from the intake agent (AGT-26), or a seeded one until run D.
- **Steps:**
  1. [human] In the project channel, read the draft card and confirm it.
- **Expected:**
  - The quote is sent as if the admin had sent it on the web; the confirmation records the admin as the confirmer.
  - A Discord user who lacks the quoting grant cannot confirm it.
- **Edge cases:** the agent itself never confirms.

## D: agents and analytics

### AGT-26: The intake agent drafts a quote a person confirms

- **Actor:** intake agent, team admin · **Surface:** web (`{dash}/walk-crew/projects/{id}`), Discord · **Delivered by:** D · **Status:** Planned (D)
- **Preconditions:** a new request on any surface (seller page, AI plugin, or Discord).
- **Steps:**
  1. Open the new project on the team's project page.
  2. Edit or confirm the agent's draft quote.
- **Expected:**
  - A draft quote proposal appears for the request without anyone asking; nothing reaches the client until a person with the quoting grant confirms it.
  - After the confirmation the client gets the quote as from the web.
  - The same draft can be confirmed in Discord (AGT-25).
- **Edge cases:** an agent actor is refused any action that moves money or commits the client (for example refunding a client), whatever it tries.

### AGT-27: The team sees its analytics in AG Studio

- **Actor:** team admin · **Surface:** web (dashboard) · **Delivered by:** D · **Status:** Planned (D)
- **Preconditions:** walk-crew with paid projects and settled payouts.
- **Steps:**
  1. Open the team's analytics page.
- **Expected:**
  - AG Studio shows custom widgets for the money flow, payouts, and work done by agents and by people, with numbers that match the ledger.
- **Edge cases:** members see only what their role allows.

### AGT-28: The team copilot answers questions about the team's money

- **Actor:** team admin · **Surface:** web (AG Studio) · **Delivered by:** D · **Status:** Planned (D)
- **Preconditions:** AGT-27.
- **Steps:**
  1. Ask the copilot "What did we make this week?"
- **Expected:**
  - The copilot answers from the ledger and PayPal (read with the team's credentials) and adds a widget with the answer to the analytics page.
  - It can read but cannot move money or confirm anything.
- **Edge cases:** this agent is cut before the analytics page if run D slips.

## Optional: the AI seller

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

### AGT-30: The demo runs end to end on the deployed hosts

- **Actor:** client, team admin, freelancer · **Surface:** Claude or ChatGPT, Discord, web · **Delivered by:** Freeze · **Status:** Planned (Freeze)
- **Preconditions:** runs H, C, B, E and D done; the seeded demo team pays completed projects with hold 0.
- **Steps:**
  1. [human] Follow program §5: search in the AI (AGT-10), request the studio (AGT-11), confirm the intake draft in Discord (AGT-25, AGT-26), accept and pay the deposit (AGT-12, AGT-13), deliver with `/deliver` (AGT-23), accept and pay the balance (AGT-14), then ask the copilot (AGT-28).
- **Expected:**
  - Every step works without falling back to the dev tunnel; the member's project payout is created and sent by the cron (OUT-17).
- **Edge cases:** the optional AI seller purchase (AGT-29) runs last.
