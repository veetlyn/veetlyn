# Discord ticket flow (run 5b-2): design

> **Current scope, 2026-10-28:** Run E is cancelled for this delivery. Retain this as design history; do not schedule its bot/channel work. Optional selected-channel adapters use Chat SDK after the contextual dash, as described in [Calls and the agent](2026-10-27-calls-and-agent-design.md) §8. Existing S2 code is not removed.

**Date:** 2026-10-13. **Status:** reframed on 2026-10-13 by the agentic surfaces program (`2026-10-13-agentic-surfaces-program.md`): this becomes run E. Its flow, money rules and Discord facts carry over; the Discord-only tables (§4.1–4.3) and the Discord-specific consumer give way to the client contacts (run A2) and the delivery pipeline (run B), and the client's home surface decides where client notices go. Run E builds only the minimum the demo needs (program §4: a channel for any project, card, notices, `/deliver`, client buttons, draft confirmation); amendments, payouts, `/ask` and archiving come after the hackathon. Revise to that scope before run E's plan. On 2026-10-14 Mouhamed added request threads (program §4.1): a request gets a channel or thread where the client talks with the team's freelancers before a quote, and accepting a freelancer's quote opens the private project channel with that freelancer, with messages synced between the two. This replaces §2's "client-started requests from Discord are out of scope" and "only team members start projects" for requests. The conversations design (`2026-10-14-conversations-design.md` §7) defines the spaces, the relay, the Gateway reader and masking; run E's revision builds on it.

**Builds on:** S2 Discord (`../archive/platform/plans/2026-10-06-s2-discord.md`: sign-in with Discord, account and server link, `/veetlyn link`, `/payouts setup`, the interaction endpoint and the unused REST client), services spec §5.2 (every step on every surface), §6.6 (outbox), §8.1 (shared use cases) and §8.4 (Veetlyn's bot), R5b-1 payout rules (`2026-10-13-payout-rules-design.md`).

**Run order:** first written as run 5b-2; now run E of the agentic surfaces program.

## 1. Goal

A services team runs its client projects inside its own Discord server. A team member starts a project for a client with one command; Veetlyn creates a private channel for it, keeps a pinned card that always shows the project's current state, and lets each person act where they are: the team quotes, amends and delivers with commands, the client accepts, pays and reviews with buttons. Members check earnings and request payouts, and admins approve payouts, from Discord too. Every action goes through the same use cases as the web app, so Discord and the web always agree.

## 2. Decisions

- **Full ticket flow.** Veetlyn creates one private channel per project. The team does not need its own ticket bot.
- **Who is the client.** The user picked in `/project start client:@user`. The team can add more client users to a project (a client's colleagues) and remove them. Clients are matched by their Discord user ID and do not need a Veetlyn account.
- **Who starts.** Only team members start projects (`/project start client:@user title:`). Client-started requests from Discord are out of scope; clients keep the seller page request form.
- **Team members link Discord.** A team member's commands and clicks count only when their Discord account is linked to their Veetlyn account (S2 account link). Veetlyn then checks their team role exactly as the web does.
- **Extras in scope:** amendments, `/project assign`, adding and removing client users, archiving the channel when the project ends, payout commands, payout approval cards and member DMs.
- **Payout notices** go to one team channel an admin picks (the payouts channel), with approval cards for admins. Members get DMs about their own payouts.
- **Channel visibility.** A project channel is visible to its client users, the assigned freelancer, and one staff role the admin picks. Nobody else in the server sees it.
- **Delivery (option A).** Every committed change already writes outbox events (§6.6). Veetlyn sends each new event to a `DISCORD_OUTBOX` Cloudflare Queue; the consumer posts and edits Discord messages; a delivery table records progress and the 10-minute cron re-queues anything missed. Discord is never called inside a database transaction.
- **Three stages, one spec, three plans:** 5b-2a foundation, 5b-2b project actions, 5b-2c payouts (§3). Each stage ends with a real-server walkthrough.
- **Out of scope:** `/project draft`, client-started requests in Discord, mirroring Discord roles into Veetlyn roles, channels for projects started on the web (backlog), moving email onto the outbox, the outgoing webhooks of §8.3, cases (`/case open`).

## 3. Stages

### 3.1 5b-2a foundation

0. **S2 real-server check (first task).** S2 never had a confirmed walkthrough in a real server. Before building on it: save the interaction endpoint through the tunnel, register the dev commands in the test server, link a Veetlyn account with Discord, run `/veetlyn link` and `/payouts setup`. Any fix lands before the next task.
1. Discord settings page and bot install with the permissions of §9.1.
2. The delivery pipeline (§5): outbox delivery rows, the queue and consumer, the cron catch-up, the Discord REST client with rate limits.
3. `/project start` (channel then project), the pinned project card, notices.
4. `/project assign`, `/project client add` and `/project client remove`.
5. Archiving the channel when the project completes or is cancelled.

### 3.2 5b-2b project actions

`/quote`, `/amend` and `/deliver` (modals), and the client's buttons on the card: **Accept quote**, **Pay with PayPal** (a link), **Accept amendment** and **Decline amendment**, **Accept delivery**, **Request changes** (a modal). Every notice names who acts next.

### 3.3 5b-2c payouts

Payout events written to the outbox, `/earnings`, `/payout request`, approval cards in the payouts channel with **Approve** and **Reject** that follow the payout rules, payout notices, and member DMs.

## 4. Data

### 4.1 `team_discord_settings` (one row per team with a linked server)

| Column | Meaning |
|---|---|
| `team_id` (PK) | The services team |
| `projects_category_id` (nullable) | Category new project channels go into; none means the top of the server |
| `archive_category_id` (nullable) | Category ended project channels move to |
| `staff_role_id` (nullable) | Role that sees every project channel |
| `payouts_channel_id` (nullable) | Channel for payout notices and approval cards |
| `bot_checked_at`, `bot_missing_permissions` (text[]) | Result of the last permission check (§9.2) |
| `updated_at` | |

The guild ID stays on `services_team_settings.discord_guild_id` (S2). Changing the staff role or categories applies to channels created after the change.

### 4.2 `project_client_user`

`project_id`, `discord_user_id`, `added_by_id` (Veetlyn user), `added_at`; primary key (`project_id`, `discord_user_id`). `/project start` inserts the first row and also fills `project.client_discord_id` as today. A project keeps at least one client user.

### 4.3 `discord_message`

The Discord messages Veetlyn edits later: `id`, `team_id`, `kind` (`project_card`, `payout_card`), `project_id` or `payout_request_id`, `channel_id`, `message_id`, `created_at`. Unique per (`project_id`, `kind`) and per (`payout_request_id`, `kind`). Notices and DMs are not stored here.

### 4.4 `outbox_delivery`

One row per (outbox event, target); the only target in this run is `discord`. Columns: `outbox_id`, `target`, `status` (`pending`, `delivered`, `not_needed`, `failed`), `steps_done` (text[]: which of the event's Discord actions finished, §5.3), `attempts`, `next_attempt_at`, `last_error_code`, `last_error`, `updated_at`. The row is inserted in the same transaction as its outbox event, always as `pending`; the consumer decides whether Discord needs it.

### 4.5 Changes to existing tables

- `project.source` gains `discord`. `project.channel_id` gets a unique index where not null, because commands find their project by channel.
- `outbox` gains `payout_request_id` (nullable). Sequence is per subject: per project for project events (as today), per payout request for payout events, which carry `project_id` null and name the project in `data` when there is one. A unique index on (`payout_request_id`, `sequence`).
- `OUTBOX_EVENT_TYPES` gains `project.client_added`, `project.client_removed`, `payout.rejected`, `payout.waiting`, `payout.succeeded` and `payout.exported`. `payout.approved` is written for each approval and carries the count so far and the count needed.

## 5. Delivery pipeline

### 5.1 Writing and sending

- The unit of work (`runInTransaction`) and the payout writers insert outbox events and their `outbox_delivery` rows in the same transaction as the change, and return the new event IDs.
- After the commit, the caller sends the IDs to `DISCORD_OUTBOX` through an `OutboxDispatcher` in the request context (tRPC, interactions, cron, queue consumers), inside `waitUntil`. A failed send is only logged: the cron catch-up finds the row.
- The 10-minute maintenance cron re-queues `pending` rows whose `next_attempt_at` has passed and that are older than 2 minutes.

### 5.2 Consumer

For each message:

1. Load the event and its delivery row. Skip it unless the row is `pending`.
2. **Order:** when an earlier event of the same subject (same project or payout request, lower sequence) is still `pending`, retry this message in 30 seconds. `delivered`, `not_needed` and `failed` all count as done, so one failed event never blocks a project forever.
3. **Decide:** mark `not_needed` when the team has no linked server, or the event has nothing to show (a project event for a project without a channel; a payout event when neither the payouts channel nor a DM applies).
4. **Act:** run the event's steps (§5.3), recording each finished step in `steps_done`.
5. Mark `delivered`.

The consumer runs with a small batch and concurrency 1 for now; the order check keeps it correct if concurrency grows later.

### 5.3 Steps and duplicates

An event can need several Discord actions: edit the project card, post a notice, update a payout card, send a DM. Each is a named step. Cards are rebuilt from the current database state, never from the event's snapshot, so editing a card twice is harmless and an old event cannot show stale data. Posting a notice or DM is not idempotent, so it records its step after the post and sends a `nonce` derived from the event and step with `enforce_nonce`, which makes Discord drop a repeat sent within a few minutes.

### 5.4 Errors

- **429:** wait `retry_after` (from the body or the `Retry-After` header) and retry the message with that delay. The attempt does not count toward the backoff.
- **5xx, timeouts:** back off 30 seconds, 2 minutes, 10 minutes, 1 hour, 6 hours, then mark `failed`.
- **Permanent:** Missing Permissions (50013), Missing Access (50001), Unknown Channel (10003), Unknown Guild (10004): mark `failed` at once with the code. The settings page lists failed deliveries with the fix (§9.2) and a **Retry** that sets them back to `pending`.
- **Unknown Message (10008)** on a card edit: someone deleted the card. Post and pin a new one, and update `discord_message`.
- **Cannot send messages to this user (50007)** on a DM: the member has closed DMs. The step counts as done and the delivery records it; no retry.

## 6. Project channel

### 6.1 Start

`/project start client:@user title: [brief:]`, run in the linked server by a team member allowed to start projects on the web.

1. Defer (ephemeral). Check the server is linked, the invoker is a linked team member with the permission, and the client is not a bot.
2. Generate the project ID, then create the channel: name `proj-<title slug>-<first 4 characters of the project ID>` (lowercase, at most 100 characters), in the projects category, with these overwrites:
   - `@everyone`: deny View Channel.
   - The bot: allow View Channel, Send Messages, Embed Links, Attach Files, Read Message History, Pin Messages.
   - Each client user and the staff role: allow View Channel, Send Messages, Attach Files, Read Message History.
3. Start the project with that ID through the `startProject` use case: `source = discord`, `channel_id`, `client_discord_id`, the first `project_client_user` row. If it fails, delete the channel (log if the delete fails) and show the use case's message.
4. Reply with a link to the channel. The `project.created` event posts and pins the project card.

### 6.2 Card and notices

- **Card (one per project, pinned):** title, status, client users, assigned freelancer, the current quote with numbered items, payments (paid and due), deadline, and the next step naming who acts. Its buttons depend on the state (§7.2). It has a link button to the client page (`/c/{token}`), as services spec §5.2 says.
- **Notices:** a short message for each event that needs someone, mentioning that person, for example "@client, the quote is ready: $1,200. Accept it on the pinned card." Card edits do not ping anyone, so notices do. Every post sets `allowed_mentions` to the named users only; Veetlyn never pings `@everyone` or roles.

### 6.3 Assign and clients

- `/project assign freelancer:@user` in a project channel, with the web's assign permission. The freelancer must be a linked team member. Veetlyn adds their overwrite and removes the previous freelancer's, unless that person is also a client user.
- `/project client add user:@user` and `/project client remove user:@user`, for team members who can start projects. Add writes the row and the overwrite; remove deletes both and refuses to remove the last client user.
- All three write outbox events, and the overwrite changes run as steps of those events, so they retry like everything else.

### 6.4 Archive

On `project.completed` or `project.cancelled`: rename the channel `done-…` or `cancelled-…`, move it to the archive category when one is set, and set client users and the freelancer to read only (deny Send Messages). Veetlyn never deletes a project channel. A Discord category holds at most 50 channels: when the archive category is full the channel stays where it is (renamed), and the settings page shows a warning.

## 7. Commands, buttons and modals

### 7.1 Commands (5b-2a and 5b-2b)

| Command | Where | Who | What |
|---|---|---|---|
| `/project start client:@user title: [brief:]` | linked server | can start projects | §6.1 |
| `/project assign freelancer:@user` | project channel | can assign | §6.3 |
| `/project client add\|remove user:@user` | project channel | can start projects | §6.3 |
| `/quote [freelancer:@user]` | project channel | allowed by the quoting mode, as on the web | opens the quote modal |
| `/amend` | project channel | assigned freelancer or a manager | opens the amendment modal |
| `/deliver` | project channel | as on the web | opens the delivery modal |

Commands that need a project find it by the channel and answer "Run this in a project channel" elsewhere. Every reply to a command is ephemeral.

### 7.2 Card buttons (5b-2b)

| State | Buttons | Who may click |
|---|---|---|
| Open quote | Accept quote | client users |
| Payment due (deposit, top-up, balance) | Pay with PayPal (link to `/pay/{token}`) | anyone who sees it; the pay page does the rest |
| Pending amendment | Accept amendment, Decline amendment | client users |
| Delivered | Accept delivery, Request changes (modal) | client users |
| Always | Open client page (link) | anyone who sees it |

- A button's `custom_id` is `pl1:<action>:<entity id>` (the quote, amendment or delivery). When the entity is no longer the current one, the click is refused ("This card is out of date. Use the pinned card.") and the card is refreshed.
- Clicks from anyone who is not a client user of the project get "Only the client can accept this quote." (or the matching action) and change nothing. A team member cannot accept on a client's behalf.
- Clicks that change state defer (ephemeral) and answer with the result; the card itself updates through the outbox.

### 7.3 Modals (5b-2b)

Discord shows a modal only as the first answer to an interaction, inside the 3-second window, so Veetlyn opens modals without reading the database. All checks run when the modal is submitted (deferred).

- **Quote:** "Items", a paragraph field of up to 10 lines, one item per line as `Description | 120.00 | 2` (extra days optional); "Delivery days". The `freelancer` option travels in the modal's `custom_id`. Bad lines are listed back by line number. Quotes with more than 10 items use the web form.
- **Amendment:** "Add items" (same line format), "Remove items" (item numbers from the pinned card, comma-separated), "Note".
- **Delivery:** "Note", "Link", and an optional file through the modal file upload. Veetlyn copies the file into delivery storage while handling the submit, with the web's size limit; a larger file gets a pointer to the web form.
- **Request changes** (client): "What should change?".

## 8. Payouts in Discord (5b-2c)

- **Events.** The payout writers (request, approval, rejection, the project sweep, the send sweep, settlement, Payouts Web export and import) write `payout.*` events in their transactions. `payout.waiting` is written when a wait reason is set or changes, not on every retry.
- **`/earnings`:** ephemeral; available, reserved, on hold and paid out for the invoking member in this server's team, with a link to `/me/payouts`.
- **`/payout request [amount:]`:** ephemeral; the full available amount when no amount is given. It runs the same request use case as `/me/payouts`, so the payout rules decide, and replies with the result (approved and when it sends, waiting for one or two admins, or refused with the reason).
- **Approval card** in the payouts channel for each payout that needs approval: member, amount, source (request or project), approvals ("1 of 2"), wait reason. **Approve** and **Reject** work for team admins with a linked Discord account and follow the rules exactly as the web: no self-approval, no second approval by the same admin, the eligible approvers. Reject asks for the same fields as the web. Once decided, the card shows the outcome and loses its buttons.
- **Notices** in the payouts channel: sent, succeeded, failed, waiting (with the reason), exported to Payouts Web.
- **DMs** to the member: approved, rejected, sent, succeeded, failed. Closed DMs are skipped (§5.4).
- Without a payouts channel, payout cards and notices are `not_needed`; DMs still go out.

## 9. Install and settings

### 9.1 Bot install

The install link on the settings page asks for View Channel, Send Messages, Embed Links, Attach Files, Read Message History, Manage Channels, Manage Roles and Pin Messages, with the team's guild preselected. Manage Roles is what lets the bot write channel overwrites; Discord lets the bot grant only permissions it holds itself. Commands are registered globally in production and per guild in development (`DISCORD_DEV_GUILD_ID`), so dev changes show at once.

### 9.2 Settings page (`/admin/[storeSlug]/discord`)

After the server link:

- **Bot:** installed or not, with the install link; the last permission check and any missing permission by name.
- **Menus:** projects category, archive category, staff role, payouts channel. Options are loaded through the bot (the guild's channels and roles); saving checks the bot can see and manage them.
- **Members:** which team members have linked Discord, since only they can use commands and buttons.
- **Status:** the last delivered event and failed deliveries with their reason, the fix ("Give the Veetlyn bot Manage Roles", "The payouts channel was deleted, pick another") and **Retry**.

Only team admins (`manage_connections`) see and change this page.

## 10. Errors and edge cases

- Interactions answer within 3 seconds by deferring, as S2 does; the follow-up edits the deferred reply.
- A member who leaves the team keeps their Discord account link but loses command access, because every command checks the current role.
- A client user who leaves the server keeps their row; removing them is the team's choice.
- A deleted project channel: events for it fail with Unknown Channel and show on the settings page. Veetlyn does not recreate the channel; the project continues on the web.
- Unlinking the server (S2) stops delivery: new events become `not_needed`; existing channels stay.
- The same Discord user can be a client of one project and a member of the team; clicks are judged by their role in that project (client buttons) or in the team (commands, approvals).
- Rate limits and outages delay Discord, never the change itself: the database commits first and Discord catches up.

## 11. Testing

- **Core tests:** quote line parsing (formats, errors by line), channel names, `custom_id` encoding, card and notice builders per state.
- **Consumer tests** against the test database and a fake Discord REST client that records calls and returns scripted answers: order per subject, `not_needed`, 429 `retry_after`, backoff to `failed`, permanent errors, Unknown Message re-posting the card, closed DMs, `steps_done` resuming after a partial failure.
- **Interaction tests** (signed payloads, as S2): each command and button, role and client checks, stale cards, modal submits, the 3-second defer.
- **Router tests:** settings page API and permission checks.
- **Walkthrough per stage** in a real test server with three Discord accounts (team admin, freelancer, client) through the tunnel: 5b-2a start, assign, add and remove a client, complete or cancel and archive; 5b-2b quote, accept, pay in the sandbox, amend, deliver, request changes, accept delivery; 5b-2c earnings, request, two-admin approval from cards, DMs. Mouhamed provides or logs into the Discord accounts the automation cannot create.

## 12. Discord facts (checked against discord.com/developers/docs on 2026-10-13)

| Fact | Value |
|---|---|
| Permission bits | View Channel `1<<10`, Send Messages `1<<11`, Embed Links `1<<14`, Attach Files `1<<15`, Read Message History `1<<16`, Manage Channels `1<<4`, Manage Roles `1<<28`; Pin Messages is a separate bit (`1<<51`, split from Manage Messages), confirmed in the 5b-2a plan's first task |
| Interaction types | 1 PING, 2 command, 3 component, 4 autocomplete, 5 modal submit |
| Callback types | 4 message, 5 deferred message, 6 deferred update, 7 update message, 9 modal |
| Components | `custom_id` at most 100 characters; at most 5 buttons per action row; modals use Label components wrapping text inputs (text inputs inside action rows are deprecated) and support a file upload component |
| Modals | Only as the first response to an interaction; at most 5 top-level components |
| Messages | `nonce` (at most 25 characters) with `enforce_nonce` drops duplicates sent within a few minutes; `allowed_mentions` limits pings |
| Limits | 50 channels per category, 500 channels per server; 429 answers carry `retry_after` |

## 13. Open items for the plans

- Confirm the Pin Messages bit and that pinning needs it (not Manage Messages) for bots.
- Confirm the modal file upload limits for bots and how the submit carries the attachment.
- Pick the exact delivery-step names per event type and write them in the 5b-2a plan.
- Check whether the PayPal webhook queue's consumer setup in `packages/infra/alchemy.run.ts` can be copied for `DISCORD_OUTBOX`.
