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
- The spike client's existing projects: `7fdfc323` "Logo refresh" (in progress, deposit paid) and `70202b60` "Logo refresh" (quoting, no quote). The walkthrough creates a third.

## Part A: Claude (claude.ai)

| Step | Who | Do | Expected |
|---|---|---|---|
| A1 | agent | New chat. Type: `I need a new logo for my bakery, budget $300, done within a week.` | Claude loads the `hire-a-professional` skill and calls `search_offerings` without being told to use Payleor (no web search first). The offerings card shows Walk Crew's "Logo refresh" ($150, by people, usually 1–7 days) with a **Request a quote** button. Claude recommends in two or three sentences and says the results come from Payleor sellers |
| A2 | agent | Press **Request a quote** on the Logo refresh card | A user message appears: "I'd like a quote for Logo refresh by Walk Crew. Help me write the brief." with no id in it. Claude asks at most three short questions; if it needs the current logo, it asks for a link (it does not offer an upload) |
| A3 | agent | Type: `It's for Pain Doré, a bakery. Keep the wheat icon, modernise the lettering. Current logo: https://example.com/pain-dore-logo.png. SVG and PNG, within a week.` | Claude shows a short brief with the logo link in it and asks "Send this to Walk Crew?" (or close). It does not call `request_quote` yet |
| A4 | agent | Type: `yes` | `request_quote` runs; the card shows "Logo refresh with Walk Crew", **Quoting**, "Waiting for Walk Crew to send a quote." with **Refresh** and **Open project page**. No tool name in the card text. Claude says Payleor emailed a private link to the project page and does not promise file sharing or messages there |
| A5 | seller | In the admin, open `walk-crew` → Projects → the newest "Logo refresh" (brief starting "It's for Pain Doré" or close). Walk Crew quotes in "assigned" mode, so first assign the project to Walk Through, then send a quote as Walk Through: $150, 4 days | The project shows the quote proposed |
| A6 | agent | New chat. Type: `Any news on my bakery logo?` | `list_my_projects` shows three "Logo refresh" rows, each with "requested Oct 14" and the start of its brief, newest activity first. Claude opens the Pain Doré one with `get_project`: **Quoting**, Quote $150.00, 4 days, **Accept quote** button. Claude tells the user to press the button and points out anything that differs from the request |
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

Record every difference from Claude: whether **Request a quote** sends the message, whether the pay button opens a new tab (`openExternal`), whether **Check payment** updates what ChatGPT says, and any "Unhandled Script Error" or blank card (write down the time, Droid checks the server log).

## Results

| Step | Claude | ChatGPT | Notes |
|---|---|---|---|
| A1 | | | |
| A2 | | | |
| A3 | | | |
| A4 | | | |
| A5 | | | |
| A6 | | | |
| A7 | | | |
| A8 | | | |
| A9 | | | |
| A10 | | | |
| A11 | | | |
| A12 | | | |
| A13 | | | |
| A14 | | | |
| A15 | | | |
| A16 | | | |
| A17 | | | |
| A18 | | | |
| A19 | | | |
| A1 without @Payleor | n/a | | |
