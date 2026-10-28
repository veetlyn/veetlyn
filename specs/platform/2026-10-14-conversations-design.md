# Conversations: requests and projects on every surface

> **Current scope, 2026-10-28:** Web/plugin conversations remain built foundations. Dedicated Discord request-thread/project-channel work (E) is cancelled for this delivery; its sections below are future references. Business conversations and the agent's calls are distinct: [Calls and the agent](2026-10-27-calls-and-agent-design.md) is the current agent design.

**Date:** 2026-10-14. **Status:** approved by Mouhamed on 2026-10-14 (sections in brainstorming, then the written document, including the details in §2, §4, §5 and §8 filled in while writing). Built across runs C, B and E (§9).

**Builds on:** the program's marketplace rules (`2026-10-13-agentic-surfaces-program.md` §4.1), the action catalog (`2026-10-13-action-catalog-design.md`: `perform`, actors, client contacts from A2), the Discord design (`2026-10-13-discord-ticket-flow-design.md`, revised for run E on top of this one), the plugin spike facts (`2026-10-14-plugin-spike-facts.md`).

## 1. Goal

Before a quote is accepted, a team's freelancers and the client talk about the request: freelancers ask questions and quote, staff can decline with a reason. After a quote is accepted, the chosen freelancer works with the client and staff in a private space that holds the whole history. Mouhamed described this in Discord terms (a public request thread and a private project channel, messages synced between them). This design puts the conversation in Payleor's core so the web, the client's AI, email, the API and Discord all show the same thing in their own form.

## 2. Decisions

- **Two spaces per request, in core.** Every message belongs to the request space or the project space. Discord channels and roles, web tabs and labels, and the AI's summaries are renderings of these spaces; no surface keeps its own access rules.
- **The request space is public to the team's eligible freelancers:** the freelancers of the team whose departments include the offering's department. A request with no department (the "Something else" request, or an offering outside any department) is visible to every freelancer of the team. Staff can replace the eligible set with a shortlist of their choice. Freelancers of other teams never see it (Mouhamed, 2026-10-14).
- **This is the team's "open" quoting mode.** In "open" mode the request space is public to eligible freelancers and each of them can quote as themselves; the client picks one (Mouhamed, 2026-10-14). In "assigned" and "team" modes, the request space holds staff and the assigned freelancer only, as today's visibility rule does.
- **The project space exists from the request on,** with the client and staff in it. Request-space activity is relayed into it, so the client and staff see every question, quote and message. When a quote is accepted, its freelancer joins the project space and sees the full history; the request space closes and the other freelancers lose access.
- **Contact details are masked until a quote is accepted:** email addresses, phone numbers, and links to messaging, social and freelance sites. File links (Drive, Dropbox, Figma and other sites) pass so briefs can share files. The text as written is kept for admins and disputes (Mouhamed, 2026-10-14).
- **Questions, quotes and declines answer a request.** The 48-hour response rule counts the first of them from the team.
- **Discord reads plain messages** through the Gateway, held by a Durable Object, with a Reply button (a modal) as the fallback if the Gateway fails (Mouhamed, 2026-10-14).

## 3. Today (checked against the code on 2026-10-14)

- Quoting modes `open`, `assigned` and `team` exist (`packages/core/src/services-teams/types.ts:9`). In `open` mode any freelancer quotes as themselves (`packages/core/src/projects/permissions.ts:35`), and freelancers see quoting projects only in that mode (`permissions.ts:83–92`).
- Several proposed quotes can exist at once; accepting one assigns its freelancer and supersedes the others (`packages/api/src/use-cases/projects.ts:258–286`). Competing quotes need no new money logic.
- Offerings can belong to a department (`packages/db/src/schema/services-catalog.ts:52`, `services_department`). Team members have a title only (`packages/db/src/schema/services-teams.ts:23`); nothing links a freelancer to a department.
- A project has one `channel_id` and one `client_discord_id` (`packages/db/src/schema/projects.ts:47–48`). There is no message table; a request can only end in a quote, and the client has no way to write.

## 4. The model

| | Request space | Project space |
|---|---|---|
| Exists | From the request until a quote is accepted, or the request is declined or expires | From the request on |
| Who sees it | Staff and the eligible freelancers (departments or the shortlist) | The client and staff; the accepted freelancer from acceptance on |
| What is in it | Freelancers' questions, quotes and messages; staff messages; the client's replies, relayed in as "Client" | Everything from the request space (relayed); the private exchange between the client and staff; after acceptance, the project's messages and events |
| Discord | A thread in the department's requests channel (a private thread with a shortlist) | The private project channel |

**Message kinds:** `text`; `question` (from the team, answered by the client); `answer` (linked to its question); `event` (written by Payleor: quote sent, quote accepted, request declined with its reason, request expired, delivery submitted, changes requested, amendment proposed).

**Who writes where:**

- Freelancers and staff write in the request space; staff also write in the project space. After acceptance the accepted freelancer writes in the project space.
- The client writes once and Payleor places the message: before acceptance a reply goes to the request space (the freelancers read it, masked); a message marked "to the team only" goes to the project space. After acceptance everything goes to the project space.

## 5. Data and actions

**Tables** (Drizzle, migration in run C):

- `conversation_message`: `id`, `project_id`, `space` (`request` | `project`), `author_kind` (`client` | `member` | `system`), `author_user_id` (members), `author_contact_id` (clients, from A2), `kind`, `body` (as written), `shown_body` (masked when it was posted before acceptance), `reply_to_id`, `ref_type` and `ref_id` (a quote, decline, delivery or amendment), `surface` (`web` | `mcp` | `discord` | `api` | `email`), `discord_message_id`, `created_at`. Indexed by project and creation time.
- `member_department`: `team_id`, `user_id`, `department_id`; unique per user and department.
- `request_shortlist`: `project_id`, `user_id`; when a project has rows, they replace the department rule.
- `project.declined_reason` and `project.declined_at`, and a `declined` and an `expired` project status (closed states; `cancelled` stays for projects that started).

**Actions** (definitions in the A1 registry, run through `perform`, logged with actor and surface):

| Action | Who | Effect |
|---|---|---|
| `conversation.post` | Eligible freelancers, staff, the client, the accepted freelancer | Adds a `text` or `question` message in the space the audience rule allows |
| `conversation.answer` | The client | Adds an `answer` to a question |
| `request.decline` | Staff | Requires a reason; sets `declined`, adds an event, tells the client |
| `request.shortlist` | Staff | Sets or clears the shortlist while the request is open |
| `member.departments` | Team admins | Sets a freelancer's departments (team settings) |

Quote proposal, acceptance, decline, expiry, delivery, changes and amendments write their `event` message in the same transaction as the change, so the timeline never disagrees with the records.

**Audience rule:** one pure function in core, `conversationAccess(viewer, project, facts)`, returns the spaces a viewer can read and write. Facts: the viewer's role and departments, the quoting mode, the shortlist, the project status, the accepted freelancer, and whether the viewer is the project's client (A2: never a member of the team). Every surface and the API call it; tests cover it as a table of cases.

**Outbox:** each new message emits `message.posted` with the project, space and message id. Run B's delivery pipeline sends it to email (client notices), webhooks, and in run E to Discord.

## 6. Contact masking

- Applies to messages posted while the project is quoting, in both spaces, from every surface. Messages posted before acceptance stay masked afterwards; messages posted after acceptance are shown as written.
- Hidden: email addresses, phone numbers (seven or more digits with common separators), and links to a deny list of messaging, social and freelance sites (WhatsApp and `wa.me`, Telegram and `t.me`, Signal, Discord invites, LinkedIn, Instagram, Facebook, X, TikTok, Fiverr, Upwork, Malt, Calendly and similar). Each match becomes "[hidden until a quote is accepted]".
- File and reference links (Drive, Dropbox, Figma, WeTransfer, a website) pass.
- `body` keeps the text as written; only admins of the team see it, marked as such.
- The same masking applies to the request brief shown to freelancers.
- Tests: a list of real examples (spaced-out emails, international phone formats, links with tracking parameters) with the expected output. Contact details written out in words are not caught.

## 7. Surfaces

**Web, freelancers:** an **Open requests** board lists the requests the audience rule shows them, newest first, with the department and the 48-hour countdown. A request opens to the brief, the request space and the quote form. After winning, the project joins their projects with the full history.

**Web, staff:** the admin project page gets a **Request** tab (freelancers' activity grouped by freelancer, the shortlist control, Decline with a reason) and a **Project** tab (the exchange with the client). Team settings gain each freelancer's departments.

**Web, client (`/c/{token}`):** no spaces shown. Replies are grouped by freelancer, each with their questions, their quote and an **Accept** button per quote, plus messages from the team and the events. The message box says who will read it: before acceptance "The freelancers looking at your request (contact details are hidden until you accept a quote)", with a "team only" choice; after acceptance "Your freelancer and the team". Questions show an Answer box.

**Client's AI (plugin):**

- `get_project` returns a summary (for example "3 freelancers responded: Aïcha quoted $150 in 4 days; Ben asked whether you have the vector file.") and the open questions with their ids.
- The card shows one slide per freelancer with their quote or question, and **Accept quote** on each quote (the widget-only tool and confirmation token from the spike).
- A `reply` tool posts the client's message or answers a question. Its description and result say who will read it, and the skill tells the model to confirm the wording with the user first. Sending a message is not a commitment, so it needs no widget button.
- A declined or expired request shows the reason and offers to search again.

**Email:** a notice to the client for new questions, quotes and team messages, batched (at most one every 15 minutes per project), linking to the client page (run B).

**API and webhooks:** `message.posted` events and endpoints to list and post messages with an API key that has the permission (run B).

**Discord** (run E):

- The team maps each department to a requests channel (or uses one channel for all) and picks the staff role. A new request in `open` mode creates a thread in its department's channel, visible to the department's role; with a shortlist, a private thread with those freelancers and the staff role.
- The project channel is private to the client's Discord users (when the client is on Discord) and the staff role; the accepted freelancer is added at acceptance. When the client is not on Discord, the channel is team-only and the client uses the web or their AI.
- Relayed messages are posted through a channel webhook under the author's name with a short label ("Client", "from the request").
- Plain messages are read through the Gateway in a Durable Object (Message Content intent). Messages from people Payleor does not know (not a client contact or a linked team member) are not relayed. Before acceptance, a message with contact details is deleted and reposted masked through the webhook, with a short notice to its author.
- Fallback if the Gateway fails: a **Reply** button on the pinned card and on relayed messages opens a modal; the interaction endpoint posts the message.

## 8. Errors and edge cases

- A relay to Discord or an email is delivered at least once with a stored delivery row; the cron retries. A failure on one surface never blocks a post on another.
- A post to a space the viewer can no longer write (the request closed, a freelancer lost access at acceptance) is refused with a message that says why.
- Removing a freelancer from a department or the shortlist removes their access to open requests at once; their earlier messages stay.
- A shortlist with nobody left falls back to the department rule.
- The 48-hour clock starts at the request's creation and stops at the team's first question, quote or decline. A reminder goes to staff at 24 hours; at 48 hours the request expires (`expired`, an event, a notice to the client) unless staff extended it once by 48 hours.

## 9. Placement

| Run | Builds |
|---|---|
| C | Tables, actions, the audience rule, masking, events from the existing use cases; the web client page, the staff tabs, the Open requests board, member departments; the plugin's summary, per-freelancer quote slides and `reply` tool; decline with a reason |
| B | Email notices for messages, `message.posted` webhooks and API endpoints, the 48-hour reminder and expiry |
| E | Department channels and threads, the private project channel, the relay through the delivery pipeline, the Gateway Durable Object and masking in Discord, the Reply fallback |

If run C runs short, the request space ships with questions and answers only (no free text), and free text follows; this sits in the program's cut order after the Discord request-thread sync.

## 10. Testing

- The audience rule as a table: each role, quoting mode, department and shortlist case, before and after acceptance, with the client and a team member holding the client's email.
- Masking against the example list.
- Use cases with the real database: post and answer from each actor, decline with and without a reason, the shortlist replacing the department rule, acceptance moving the accepted freelancer into the project space and closing the request space, event messages written in the same transaction as the change.
- The plugin's `reply` and `get_project` summary at the MCP boundary with a scripted client; Discord relay and masking against a test server in run E's walkthrough.

## 11. Out of scope

Requests visible to freelancers of other teams; replies by email; attachments in messages (files keep going through deliveries and links); read receipts and typing indicators; editing or deleting messages after posting (except Discord's masked repost); translation.
