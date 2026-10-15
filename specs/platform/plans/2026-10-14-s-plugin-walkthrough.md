# Spike S walkthrough: the whole client flow in Claude and ChatGPT

**Date:** 2026-10-14. **For:** Claude in Chrome (or a person), on Mouhamed's machine over the tunnel, against the spike connector (branch `spike-plugin`, widget `ui://payleor/app-v5`). The run C versions of these checks are stories AGT-09 to AGT-15 in [`../../stories/09-agentic.md`](../../stories/09-agentic.md).

## Rules for the agent

- **[human]** steps are Mouhamed's: approving a payment in the PayPal popup, connecting or re-connecting the plugin. Stop and ask him.
- **[seller]** steps happen on the team side, in the admin at `https://admin.payleor.com` signed in as the walk-crew owner (`mdbm-agent@agentmail.to`). Do them in a separate Chrome profile or window, or ask Droid to do them. Never sign in to the plugin's OAuth screen as the walk-crew owner: a team member is never the client, and every tool would refuse.
- Start a **new chat** where a step says so. Type the prompts exactly. Do not mention Payleor unless the prompt does.
- After each step, take a screenshot of the chat (name it `walk-<client>-<step>.png`, for example `walk-claude-A4.png`) and fill the results table at the end: pass or fail, and what was different from **Expected**.
- Never type card numbers, PayPal passwords or pay links into the chat.

## Setup (Droid, before the run)

- The dev stack and tunnel run from `worktrees/spike-plugin` with the latest commit; `https://api.payleor.com/mcp` answers 401 without a token.
- `payleor-plugin.zip` is the latest build. In Claude, the Payleor plugin is uploaded from it and its connector is signed in as the spike client `mdbm-agent+spike-mcp@agentmail.to`. In ChatGPT, the Payleor connector is refreshed (it lists 7 tools).
- The spike client has one project: `00fbf3ae` "Logo refresh" (quoting, brief starting "Logo refresh for Pain Doré"), created by the walkthrough's A1–A4. Older test projects were cleaned up on 2026-10-14: `70202b60` deleted (no payments), `7fdfc323` archived off the client's account (its captured $90 deposit has ledger entries, so it was retitled "Spike test (archived)" and moved to `spike-archive@payleor.invalid`; a database backup is at `/tmp/jendal-dev-before-cleanup-2321.dump` on Mouhamed's machine).

## Part A: Claude (claude.ai)

| Step | Who | Do | Expected |
|---|---|---|---|
| A1 | agent | New chat. Type: `I need a new logo for my bakery, budget $300, done within a week.` | Claude loads the `hire-a-professional` skill and calls `search_offerings` without being told to use Payleor (no web search first). The offerings card shows Walk Crew's "Logo refresh" ($150, by people, usually 1–7 days) with a **Request a quote** button. Claude recommends in two or three sentences and says the results come from Payleor sellers |
| A2 | agent | Press **Request a quote** on the Logo refresh card | A user message appears: "I'd like a quote for Logo refresh by Walk Crew. Help me write the brief." with no id in it. Claude asks at most three short questions; if it needs the current logo, it asks for a link (it does not offer an upload) |
| A3 | agent | Type: `It's for Pain Doré, a bakery. Keep the wheat icon, modernise the lettering. Current logo: https://example.com/pain-dore-logo.png. SVG and PNG, within a week.` | Claude shows a short brief with the logo link in it and asks "Send this to Walk Crew?" (or close). It does not call `request_quote` yet |
| A4 | agent | Type: `yes` | `request_quote` runs; the card shows "Logo refresh with Walk Crew", **Quoting**, "Waiting for Walk Crew to send a quote." with **Refresh** and **Open project page**. No tool name in the card text. Claude says Payleor emailed a private link to the project page and does not promise file sharing or messages there |
| A5 | seller | In the admin, open `walk-crew` → Projects → the newest "Logo refresh" (brief starting "Logo refresh for Pain Doré" or close). Walk Crew quotes in "assigned" mode, so first assign the project to Walk Through, then send a quote as Walk Through: $150, 4 days | The project shows the quote proposed. (Done by Droid for the Claude run at 23:08: assigned to Walk Through, quote $150 / 4 days proposed) |
| A6 | agent | New chat. Type: `Any news on my bakery logo?` | `list_my_projects` shows the "Logo refresh" row with "requested Oct 14" and the start of its brief. Claude opens it with `get_project`: **Quoting**, Quote $150.00, 4 days, **Accept quote** button. Claude tells the user to press the button and points out anything that differs from the request |
| A7 | agent | Type: `Accept that quote for me.` | Claude does not say it accepted. It explains the user accepts with the **Accept quote** button in the card (it cannot call the accept tool). In the admin the quote is still proposed |
| A8 | agent | Press **Accept quote** in the card | The card switches to **Awaiting deposit** with **Pay $90.00 with PayPal** and **Check payment** (deposit: $75 half of the quote plus Walk Crew's 10% management fee, $15). Type `what now?`: Claude knows the quote was accepted and the deposit is next |
| A9 | human | Press **Pay $90.00 with PayPal**. A new tab opens Payleor's pay page. Approve in the PayPal popup as buyer 2 (`sb-vexyv53252581@personal.example.com`) | The pay page shows the payment as received |
| A10 | agent | Back in Claude, press **Check payment**. Then type `is it paid?` | The card switches to **In progress** ("Walk Crew is working on it; delivery is planned within 4 days of the deposit."). Claude answers that the deposit is paid without being told (the card updated its context) |
| A11 | seller | In the admin project, submit a delivery: note "First version attached", link `https://example.com/pain-dore-v1` | The project shows **Delivered** |
| A12 | agent | New chat. Type: `Is my Pain Doré logo ready?` | The card shows **Delivered** with the note, **Accept delivery** and **Request changes** |
| A13 | agent | Press **Request changes** | A user message appears ("I want changes to the delivery of Logo refresh.") with no ids. Claude helps word the change and asks before sending |
| A14 | agent | Type: `Make the wheat icon a bit bigger and use a warmer brown. Send it.` | `request_changes` runs; the card goes back to **In progress**; Claude says the seller will deliver again |
| A15 | seller | Submit a second delivery: note "Bigger wheat, warmer brown", link `https://example.com/pain-dore-v2` | **Delivered** again |
| A16 | agent | Type: `Show me the new version.` Then press **Accept delivery** | The card shows the second delivery; after the press it switches to **Awaiting balance** with **Pay $75.00 with PayPal** (the other half of the quote) |
| A17 | human | Press **Pay $75.00 with PayPal** and approve in the PayPal popup as buyer 2 | The pay page shows the payment as received |
| A18 | agent | Press **Check payment**, then type `are we done?` | The card shows **Completed**; Claude says the project is completed and paid |
| A19 | agent | Type: `Show me project 42c6962f-c438-4d1d-8495-9d75b7a92501.` | Claude reports that the project is not the user's (the tool refuses) and offers to list the user's projects |

## Part B: ChatGPT (chatgpt.com)

Run A1 to A19 again in ChatGPT, with two changes:

- Start each new chat's first message with `@Payleor ` (an unpublished connector runs only when mentioned). Also run A1 once **without** `@Payleor` and record whether ChatGPT uses Payleor or another app (it used Fiverr before).
- The seller steps create a fresh project: in A5 pick the project created by ChatGPT's A4.

Setup: the plugin is uploaded to ChatGPT on the web (Plugins → Upload, zip with files at the root; needed `onboardingSkill` as a SKILL.md path). Connect it as the spike client. If the upload misbehaves, refresh the Payleor connector at chatgpt.com/plugins (7 tools) or use the desktop app's personal marketplace (`~/.agents/plugins/marketplace.json` → `~/.codex/plugins/payleor`). If several Payleor entries are connected, note which one handled each step.

Record every difference from Claude: whether **Request a quote** sends the message, whether the pay button opens a new tab (`openExternal`), whether **Check payment** updates what ChatGPT says, and any "Unhandled Script Error" or blank card (write down the time, Droid checks the server log).

## Results

| Step | Claude | ChatGPT | Notes |
|---|---|---|---|
| A1 | pass (20:53) | | Skill loaded, search unprompted; fixes in `ad55768` |
| A2 | pass (20:53) | | |
| A3 | pass (20:53) | | |
| A4 | pass (20:53) | pass (05:06) | Project `00fbf3ae` created (re-created 23:08 after cleanup); ChatGPT created `eee58c5b` (Landing page design, personal-brand brief) from the uploaded plugin |
| A5 | pass (23:08, Droid) | pass (05:1x, Droid) | Assigned to Walk Through, quote $150 / 4 days; ChatGPT project: assigned to Walk Through, quote `77813f7a` $600 / 5 days (in `assigned` mode only the assigned freelancer can quote) |
| A6 | pass (23:15) | pass (05:15) | One clean row after the duplicate cleanup; ChatGPT listed projects (05:15:24) then opened the project |
| A7 | pass (23:15–23:25) | pass (05:15–05:16) | No model-side `accept_quote` attempt in the server log for either client; both pointed to the button |
| A8 | pass (23:25) | pass (05:16) | Quote accepted from the card in both |
| A9 | pass (23:26) | pass (05:18) | $90 deposit captured; ChatGPT: $360 deposit captured (buyer 2) |
| A10 | pass (23:27) | pass (05:18–05:19) | Check payment; card switched to In progress (project `in_progress` in DB) |
| A11 | pass (23:3x, Droid) | | Delivery a5b046f0 submitted: "First version attached" |
| A12 | pass (01:29) | | Card showed Delivered with the note |
| A13 | pass (01:29–01:32) | | |
| A14 | pass (01:32) | | `request_changes` ran; card back to In progress |
| A15 | pass (01:3x, Droid) | | Delivery df852c7a submitted: "Bigger wheat, warmer brown" |
| A16 | pass (01:35) | | `accept_delivery` from the card; Awaiting balance |
| A17 | pass (01:36) | | $75 balance captured |
| A18 | pass (01:37) | | Check payment; card showed Completed |
| A19 | pass (01:37) | | `get_project` on the foreign id refused: "No project with this id belongs to you" |
| A1 without @Payleor | n/a | pass (05:27) | Unprompted "find me someone to design business cards": ChatGPT called `search_offerings` ("business card design") and showed Payleor's Walk Crew, next to a local business search listing 3 people in Dakar. (Earlier "any news?" at 05:20 was answered from cross-chat memory with no call — discovery tests need fresh-data prompts.) |
