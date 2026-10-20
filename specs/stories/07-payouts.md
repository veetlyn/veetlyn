# Payouts (OUT)

How a services team pays its members: the member's PayPal destination, the team's automatic payouts connection, requests and approvals, payout rules, the cron sweeps, and the PayPal Payouts Web fallback. The quote calculator is in [`03-requests-and-quotes.md`](03-requests-and-quotes.md).

Pages: the member's Payouts page is `{dash}/me/payouts`; the team's Payouts page is `{dash}/walk-crew/payouts`; the rules page is `{dash}/walk-crew/payouts/rules`. The maintenance cron runs every 10 minutes and runs, in order, the project payout sweep, the send sweep and the settle sweep. Amounts below use walk-crew (USD, PayPal country SN, so PayPal's fee estimate is the international 2%).

Status note: `Built (not walked through)` marks stories whose code is merged but whose path was not exercised in a recorded walkthrough (the R5c and R5b-1 Outcomes).

## Member destination

### OUT-01: Member connects a PayPal payout destination

- **Actor:** freelancer · **Surface:** web (`{dash}/me/payouts`) · **Delivered by:** S2 (`8c53d23`), R5c (`b437e78`) · **Status:** Built
- **Preconditions:** signed in as a `walk-crew` member with no destination saved; the browser is not signed in to PayPal as walk-crew's business account.
- **Steps:**
  1. Open `{dash}/me/payouts`. Under "Your PayPal payout destination", tick "I am 18 or older".
  2. Click **Log in with PayPal**.
  3. [human] Log in to PayPal as the member payout destination (sandbox buyer 1) and consent.
- **Expected:**
  - Before connecting, the section says "Connect your PayPal account once. Payleor stores your PayPal payer ID; teams pay you with it." and the Earnings card says "Connect your PayPal account above to request a payout."
  - After the return, the page shows "Verified PayPal account ({email}). Payer ID {13-character payer ID}." and "Verified {date}. Teams pay you with this PayPal account."
  - With the box ticked, it shows "Confirmed 18 or older."
  - The destination records the PayPal country (buyer 1 is US), which sets the fee estimate in OUT-07.
- **Edge cases:** PayPal reporting an age range under 18 shows "PayPal says this account belongs to someone under 18. Payouts need a recipient who is 18 or older." and removes any saved destination. Connecting without ticking the box saves the destination unconfirmed (OUT-02).

### OUT-02: Member confirms they are 18 or older after connecting

- **Actor:** freelancer · **Surface:** web (`{dash}/me/payouts`) · **Delivered by:** S2 (`8c53d23`), R5c (`b437e78`) · **Status:** Built
- **Preconditions:** a destination saved without the 18+ confirmation (OUT-01 without the box).
- **Steps:**
  1. Open `{dash}/me/payouts`.
  2. Tick "I am 18 or older" and click **Confirm**.
- **Expected:**
  - Before: "Payouts need a recipient who is 18 or older. PayPal did not share your age, so confirm it here." and the Earnings card says "Confirm you are 18 or older above to request a payout."; **Confirm** is disabled until the box is ticked.
  - After: "Confirmed 18 or older." and **Request payout** is enabled when the member has earnings.
- **Edge cases:** none.

### OUT-03: Log in with PayPal explains why a connection failed

- **Actor:** freelancer · **Surface:** web (`{dash}/me/payouts`) · **Delivered by:** R5c (`abc93b0`) · **Status:** Built
- **Preconditions:** a member with no destination.
- **Steps:**
  1. [human] Click **Log in with PayPal** while the browser is still signed in to PayPal as an account already linked to another Payleor user (for example walk-crew's business account), and consent.
  2. [human] Start again and take more than 5 minutes to finish the PayPal sign-in.
- **Expected:**
  - Step 1 returns with "This PayPal account is already connected to another Payleor account. Log out of PayPal, then log in with a different PayPal account."
  - Step 2 returns with "The PayPal sign-in took too long. Try again and finish within 5 minutes."
  - No destination is saved in either case.
- **Edge cases:** any other PayPal error shows "PayPal did not confirm the connection. Try again."; PayPal not sharing a payer ID shows "PayPal did not confirm your payer ID. Connect PayPal again."

## Automatic payouts connection

### OUT-04: Admin turns on automatic payouts

- **Actor:** team admin · **Surface:** web (`{dash}/walk-crew/payouts`) and PayPal mini-browser · **Delivered by:** R5c (`b437e78`, `0f0f58a`), R5b-1 (`a4cf6a8`) · **Status:** Built
- **Preconditions:** walk-crew has PayPal connected (see [`01-accounts-and-setup.md`](01-accounts-and-setup.md)) and automatic payouts off.
- **Steps:**
  1. Open `{dash}/walk-crew/payouts`. The "Automatic payouts" card says "Payleor sends members' payouts from this team's PayPal balance. PayPal's fee comes off each payout."
  2. Click **Turn on automatic payouts**, then **Continue in PayPal**.
  3. [human] In the PayPal window, log in as the PayPal seller (sandbox seller 3) and consent.
- **Expected:**
  - Step 2 shows "PayPal opens in a small secure window and shares this team's payout access with Payleor." and, after the consent, "Checking the connection with PayPal…".
  - The card then says "On. Payouts are sent from ••••75MG." and "Verified {date}.", with no reconnect prompt (the connection asks PayPal for the balance and transaction search permissions).
  - The dashboard checklist step "Turn on automatic payouts" is done.
- **Edge cases:** consenting with another PayPal account than the team's shows "Connect the PayPal account this team already uses (••••75MG)." and saves nothing; a team without PayPal connected gets "Connect PayPal first."; an attempt older than an hour or already used shows "This PayPal connection expired. Turn on automatic payouts again."; PayPal refusing the exchange shows "PayPal did not confirm the connection. Try again."; an account without Payouts enabled shows "PayPal has not turned on Payouts for this PayPal account. Ask PayPal to turn it on, then try again.". PayPal calling back twice for one consent completes the connection once. Before run H the sandbox consent screen names the partner app "Test Store".

### OUT-05: Admin reconnects so Payleor can read the PayPal balance

- **Actor:** team admin · **Surface:** web (`{dash}/walk-crew/payouts`) · **Delivered by:** R5b-1 (`a4cf6a8`) · **Status:** Built
- **Preconditions:** automatic payouts on with a connection made before R5b-1 (it cannot read the balance).
- **Steps:**
  1. Open `{dash}/walk-crew/payouts`.
  2. Click **Reconnect**, then **Continue in PayPal**.
  3. [human] Consent in the PayPal window as the PayPal seller.
- **Expected:**
  - Before: the card shows "Reconnect so Payleor can read your PayPal balance." with **Reconnect**; the rules page's balance floor hint says "Turn on automatic payouts again so Payleor can read your balance."
  - After: the card shows only "On. Payouts are sent from ••••75MG." and the reconnect prompt is gone.
- **Edge cases:** see OUT-22 for payouts while the balance cannot be read.

### OUT-06: Admin turns off automatic payouts

- **Actor:** team admin · **Surface:** web (`{dash}/walk-crew/payouts`) · **Delivered by:** R5c (`b437e78`), R5b-1 fixes (`2f2cb35`) · **Status:** Built
- **Preconditions:** automatic payouts on (OUT-04).
- **Steps:**
  1. Click **Turn off automatic payouts**.
  2. Confirm with **Turn off** in the dialog.
- **Expected:**
  - The dialog reads "Turn off automatic payouts?" and "Approved payouts then wait until you export them for PayPal Payouts Web or turn automatic payouts on again."
  - The card goes back to **Turn on automatic payouts**; the "PayPal Payouts Web" section appears (OUT-25).
- **Edge cases:** turning off while a send is in progress is refused with "Wait for the payouts in progress to finish."

## Requests and approvals

### OUT-07: Member requests a payout and sees PayPal's fee estimate

- **Actor:** freelancer · **Surface:** web (`{dash}/me/payouts`) · **Delivered by:** R5c (`b437e78`), R5b-1 fixes (`2f2cb35`) · **Status:** Built
- **Preconditions:** OUT-01 and OUT-02 done; the member has available earnings from a completed `walk-crew` project (see [`05-delivery-and-completion.md`](05-delivery-and-completion.md)); walk-crew on the Manual preset.
- **Steps:**
  1. Open `{dash}/me/payouts`. In the walk-crew card, enter `25.00`.
  2. Click **Request payout**.
- **Expected:**
  - The card lists "Available", "In progress" and "Paid out"; the amount field starts at the available amount.
  - Under the field: "You'll receive about $24.50 after PayPal's fee of about $0.50." (it recomputes as the amount changes).
  - After the request: "Payout requested. An admin of Walk Crew reviews it." The amount moves from Available to In progress, the History shows the request as "Waiting for approval", and the card says "Your payout request for this team is still in progress." with the field disabled.
- **Edge cases:** an amount over the available balance shows "You can request up to {available}."; under 1.00 shows "Enter at least 1.00."; over 20,000 shows "PayPal pays at most 20,000.00 at a time."; an amount that leaves less than 1.00 after the fee shows "This payout is too small to cover PayPal's fee." under the field and is refused; a second request while one is open is refused with "You already have a payout in progress for this team."; a project payout in progress (OUT-17) does not block a request. With no earnings the section says "No earnings yet. Your share of a project shows up here once the client has paid and the project is complete."

### OUT-08: Admin approves a request and Payleor sends it

- **Actor:** team admin · **Surface:** web (`{dash}/walk-crew/payouts`) · **Delivered by:** R5c (`b437e78`), R5b-1 (`a4cf6a8`) · **Status:** Built
- **Preconditions:** automatic payouts on (OUT-04); a $25.00 request waiting (OUT-07) from a member who is not the approving admin (sign in as the second admin when Walk Through is the payee).
- **Steps:**
  1. Open `{dash}/walk-crew/payouts`. In "Payout requests", find the row (From "Request", status "Waiting for approval").
  2. Click **Approve**, then confirm.
- **Expected:**
  - The dialog reads "Send $25.00 to Walk Through?" and "PayPal sends it from your PayPal account, on payday if the team has one." with the button "Send $25.00".
  - The row becomes "Sent, waiting for PayPal" with "Sends $24.50" and "PayPal's fee (about) $0.50", and a **Refresh** button.
  - The member's History shows "Approved, being sent" and "Sent $24.50".
- **Edge cases:** a request already decided gives "This payout request was already decided."; a member whose destination changed after requesting is held with "The member changed their PayPal account. Reject this request; they can request again."; a member no longer qualified is held with "The member's PayPal account no longer qualifies for payouts.".

### OUT-09: Admin rejects a request

- **Actor:** team admin · **Surface:** web (`{dash}/walk-crew/payouts`) · **Delivered by:** R5c (`b437e78`) · **Status:** Built
- **Preconditions:** a request "Waiting for approval", or an approved payout held in the queue with no unconfirmed send.
- **Steps:**
  1. Click **Reject** on the row.
- **Expected:**
  - The row shows "Rejected"; the member's History shows "Rejected".
  - The amount returns to the member's Available, and the member can request again.
- **Edge cases:** a queued payout whose earlier send PayPal never confirmed cannot be rejected: "PayPal may already have this payout. Retry it to find out."

### OUT-10: The settle sweep and Refresh settle a sent payout

- **Actor:** team admin, cron · **Surface:** web (`{dash}/walk-crew/payouts`), cron · **Delivered by:** R5c (`b437e78`) · **Status:** Built
- **Preconditions:** a payout "Sent, waiting for PayPal" (OUT-08).
- **Steps:**
  1. Wait for the next cron tick (up to 10 minutes), or click **Refresh** on the row.
- **Expected:**
  - Once PayPal reports success, the row shows "Paid", "Sent $24.50" and "PayPal's fee $0.49" (the fee PayPal charged).
  - The member's History shows "Paid", "Sent $24.50" and "PayPal's fee $0.49"; Paid out grows by the requested amount less the returned difference.
  - The ledger has, once each: `payout_succeeded` (sent amount to paid out), `payout_fee_recovered` (the smaller of the fee and the estimate), `payout_fees` (team revenue to PayPal fees) and `payout_released` for the estimate minus the fee (1¢ here, back to the member's available).
- **Edge cases:** a fee above the estimate is absorbed by the team; a failed or returned item shows "Failed" with "PayPal did not pay this payout ({status})." and releases the whole amount to the member.

### OUT-11: Retry a held or unconfirmed payout

- **Actor:** team admin · **Surface:** web (`{dash}/walk-crew/payouts`) · **Delivered by:** R5c (`b437e78`), R5b-1 (`a4cf6a8`) · **Status:** Built (not walked through)
- **Preconditions:** automatic payouts on; an approved payout held by PayPal (for example the team's sandbox balance below the amount) or a send PayPal never confirmed.
- **Steps:**
  1. Read the row's message, then click **Retry**.
- **Expected:**
  - A held payout stays "Approved, waiting to send" with one of: "The team's PayPal balance is too low. Add funds, then retry.", "PayPal refused the team's automatic payouts connection. Turn on automatic payouts again." or "PayPal has not turned on Payouts for the team's PayPal account. Ask PayPal to turn it on, then retry.", and "Next try {time}" (the send sweep retries after 15 minutes, 1 hour, 6 hours, then daily).
  - An unconfirmed send shows "Not confirmed"; Retry sends with the same PayPal batch id, so the member is paid at most once.
  - Retry sends at once when the problem is gone; the row becomes "Sent, waiting for PayPal".
- **Edge cases:** Retry does not skip the payday (OUT-20) or a floor (OUT-21); without automatic payouts there is no Retry (OUT-24). An unconfirmed send failing again shows "We could not confirm the payout with PayPal. Try again; the member will not be paid twice."; one older than the safe window gives "This payout is too old to retry safely. Contact support."

## Payout rules

### OUT-12: Admin applies a payout rules preset

- **Actor:** team admin · **Surface:** web (`{dash}/walk-crew/payouts/rules`) · **Delivered by:** R5b-1 (`a4cf6a8`) · **Status:** Built
- **Preconditions:** signed in as a walk-crew admin.
- **Steps:**
  1. On `{dash}/walk-crew/payouts`, follow "Payout rules" (": who approves payouts, and when they are sent.").
  2. Under "Presets", click **Automatic**.
  3. Change any field (for example the minimum payout) and click **Save rules**.
- **Expected:**
  - The page reads "How this team approves and sends its members' payouts." and "A preset replaces the rules below. Trusted members stay."
  - The presets read "Manual" ("An admin approves every payout."), "Rules" ("Requests up to $100.00 are approved on their own.") and "Automatic" ("Each completed project pays out on its own.").
  - Step 2 toasts "Payout rules saved."; the form shows "Pay each completed project automatically" ticked, "Pays projects completed since {today}.", hold 0 days, auto-approve "Any amount" for "Automatic payouts".
  - Step 3 toasts "Payout rules saved." and shows "Custom" next to the Presets heading.
- **Edge cases:** a freelancer or manager sees "Only an admin can change the team settings."; a solo seller sees "Payouts are for teams. As a solo seller, clients pay you directly in your PayPal account."

### OUT-13: The rules page refuses inconsistent rules

- **Actor:** team admin · **Surface:** web (`{dash}/walk-crew/payouts/rules`) · **Delivered by:** R5b-1 (`a4cf6a8`) · **Status:** Built
- **Preconditions:** walk-crew with at least two admins.
- **Steps:**
  1. Set Auto-approve to "Any amount" for "Both", set "Require a second admin above (USD)" to 500.00 for "Both", and click **Save rules**.
  2. Change "Second admin applies to" to "Member requests" and save again.
- **Expected:**
  - Step 1 shows "Auto-approve at most the second-approver amount." and saves nothing.
  - Step 2 saves ("Payout rules saved.", with "Custom" next to the Presets heading).
- **Edge cases:** a second-approver amount on a team with one admin: "Add a second admin before requiring two approvals." (also shown as the field's hint); hold days outside 0 to 90: "Hold payouts for 0 to 90 days."; a minimum under 1.00: "The minimum payout is at least $1.00."; a negative floor: "The balance floor cannot be negative.". Only the step 1 refusal was seen in a walkthrough.

### OUT-14: Requests up to an amount are approved on their own

- **Actor:** freelancer · **Surface:** web (`{dash}/me/payouts`) · **Delivered by:** R5b-1 (`a4cf6a8`), R5b-1 fixes (`2f2cb35`) · **Status:** Built
- **Preconditions:** automatic payouts on; rules auto-approve requests up to $100.00 (the Rules preset), payday "Right away", no floor.
- **Steps:**
  1. Request $20.00 on `{dash}/me/payouts`.
- **Expected:**
  - The card says "Payout approved. It is on its way to your PayPal account."
  - No admin acts: the team's row shows "Sent, waiting for PayPal", then "Paid" after settling (OUT-10).
- **Edge cases:** a request above $100.00 waits for an admin; a project payout is not covered when the scope is "Member requests".

### OUT-15: Trusted members are approved without an admin

- **Actor:** team admin, freelancer · **Surface:** web (`{dash}/walk-crew/payouts/rules`, `{dash}/me/payouts`) · **Delivered by:** R5b-1 (`a4cf6a8`) · **Status:** Built (not walked through)
- **Preconditions:** two admins; a freelancer member with a destination and earnings.
- **Steps:**
  1. As one admin, under "Trusted members", tick the freelancer, keep "Applies to" on "Member requests", and save.
  2. As the freelancer, request a payout of any amount under the second-approver amount.
  3. As the first admin, try to tick yourself.
- **Expected:**
  - "Payouts to these members are approved without an admin." heads the list.
  - Step 2 is approved at once, as in OUT-14.
  - Step 3: your own checkbox is disabled with "Another admin has to add you."; another admin can add you.
- **Edge cases:** the API refuses an admin adding themselves with "Another admin has to add you to the trusted list." and a non-member with "Trusted members must be on the team."; a member removed from the team drops off the list and is not auto-approved.

### OUT-16: A second admin must approve above an amount

- **Actor:** team admin, second and third admins · **Surface:** web (`{dash}/walk-crew/payouts`) · **Delivered by:** R5b-1 (`a4cf6a8`), R5b-1 fixes (`2f2cb35`) · **Status:** Built
- **Preconditions:** automatic payouts on; rules require a second admin above $50.00 for "Member requests"; walk-crew has three admins (Walk Through and the second and third admins); Walk Through has more than $60.00 available.
- **Steps:**
  1. As Walk Through, request $60.00 on `{dash}/me/payouts`.
  2. As Walk Through, open the team's Payouts page.
  3. As the second admin, approve the row; then click **Approve** on it again and confirm.
  4. As the third admin, approve it.
- **Expected:**
  - Step 1: "Payout requested. An admin of Walk Crew reviews it."
  - Step 2: the row shows "0 of 2 approvals" and no **Approve** button on Walk Through's own payout.
  - Step 3: the dialog reads "Approve $60.00 for Walk Through?" and "A second admin has to approve it too before it is sent."; afterwards the toast "Approved. Waiting for a second admin." and the row "1 of 2 approvals" and "Waiting for a second admin". The repeat approval is refused with "You already approved this payout."
  - Step 4: the dialog reads "Send $60.00 to Walk Through?"; the payout is sent.
- **Edge cases:** an admin approving their own payout through the API gets "You cannot approve a payout to yourself."; with fewer eligible admins than approvals needed (for example only one other admin), the row says "Add a second admin or lower the second-approver amount.". The hidden Approve button on one's own payout came with the walkthrough fixes and has not been walked through.

### OUT-17: A completed project pays out automatically

- **Actor:** cron · **Surface:** cron, web (`{dash}/walk-crew/payouts`, `{dash}/me/payouts`) · **Delivered by:** R5b-1 (`a4cf6a8`) · **Status:** Built
- **Preconditions:** automatic payouts on; the Automatic preset (or "Pay each completed project automatically" with auto-approve for "Automatic payouts"), hold 0 days; the assigned member has a destination and the 18+ confirmation.
- **Steps:**
  1. Complete a walk-crew project after "Pays projects completed since" (client pays, member delivers, client accepts, client pays the balance; see [`05-delivery-and-completion.md`](05-delivery-and-completion.md)).
  2. Wait for the next cron tick (up to 10 minutes), then for the settle sweep.
- **Expected:**
  - One payout appears with From set to the project title (a link to the project), for the member's earnings from it, sent without an admin, then "Paid" with the fee PayPal charged.
  - The member's History shows the payout with "For {project title}" and "Created {date}".
  - Later ticks create nothing more for that project; projects completed before the "since" date get no payout.
- **Edge cases:** the amount is capped at what the member has available (an earlier request may have taken some) and at 20,000.00; nothing is created when that is 0, below the team minimum or too small to cover PayPal's fee. A project gets one automatic attempt: if PayPal refuses it or an admin rejects it, the money returns to the member's Available for a request.

### OUT-18: Hold days delay automatic project payouts

- **Actor:** cron, freelancer · **Surface:** cron, web · **Delivered by:** R5b-1 (`a4cf6a8`) · **Status:** Built (not walked through)
- **Preconditions:** as OUT-17 with "Days to wait after a project completes" set to 3.
- **Steps:**
  1. Complete a project.
  2. Check the team's Payouts page over the next ticks; as the member, request part of the earnings during the hold.
- **Expected:**
  - The field's hint reads "From 0 to 90. Members can still ask for their earnings during this time."
  - No project payout exists until 3 days after completion; then one is created on the next tick.
  - The member's request during the hold works as OUT-07; the project payout then takes only what is left of that project's earnings.
- **Edge cases:** earnings of other projects still inside their hold are never taken by a project payout.

### OUT-19: A project payout waits for the member to connect PayPal

- **Actor:** team admin · **Surface:** web (`{dash}/walk-crew/payouts`) · **Delivered by:** R5b-1 (`a4cf6a8`) · **Status:** Built (not walked through)
- **Preconditions:** project payouts on; a project completes for a member without a destination or without the 18+ confirmation.
- **Steps:**
  1. After the next tick, open the team's Payouts page.
  2. As the member, complete OUT-01 and OUT-02; wait for the next tick.
- **Expected:**
  - Step 1: under "Waiting for members", "Waiting for {member} to connect PayPal: {project} ({amount})"; no payout row.
  - Step 2: the line goes away and the project payout is created.
- **Edge cases:** none.

### OUT-20: Approved payouts go on payday

- **Actor:** team admin, cron · **Surface:** web (`{dash}/walk-crew/payouts/rules`, `{dash}/walk-crew/payouts`) · **Delivered by:** R5b-1 (`a4cf6a8`) · **Status:** Built (not walked through)
- **Preconditions:** automatic payouts on.
- **Steps:**
  1. Under "Payday", choose "Once a week" and a "Day of the week" that is not today (UTC), and save.
  2. Approve a request.
  3. Click **Retry** on it.
  4. Switch the payday to "Right away" and save.
- **Expected:**
  - The form says "Payday starts at 00:00 UTC."
  - Step 2: the row shows "Approved, waiting to send" and "Goes on payday, {date}".
  - Step 3: "This payout goes on payday, {date}."
  - Step 4: the waiting payout is due at once and the next tick sends it. Otherwise the send sweep sends it from 00:00 UTC on the payday.
- **Edge cases:** "Once a month" offers days 1 to 28; on the payday itself an approval sends at once (the R5b-1 walkthrough set today's weekday, so only this path was seen).

### OUT-21: The balance floor holds payouts until the balance allows them

- **Actor:** team admin, cron · **Surface:** web (`{dash}/walk-crew/payouts`) · **Delivered by:** R5b-1 (`a4cf6a8`) · **Status:** Built
- **Preconditions:** automatic payouts on with balance access (OUT-05); auto-approve requests up to $100.00.
- **Steps:**
  1. Set "Keep at least this in the team's PayPal balance (USD)" above the team's sandbox balance (for example 10,000.00) and save.
  2. As a member, request $20.00.
  3. As an admin (not the payee), approve it.
  4. Lower the floor to 100.00, save, and click **Retry** (or wait for the next try).
- **Expected:**
  - The floor hint reads "Payleor reads your PayPal balance to apply this."
  - Step 2: the request is not auto-approved ("Payout requested. An admin of Walk Crew reviews it.").
  - Step 3: the row stays "Approved, waiting to send" with "Waiting until the team's PayPal balance stays above $10,000.00." and "Next try {time}" about 15 minutes later.
  - Step 4: the payout is sent and settles as OUT-10.
- **Edge cases:** later holds wait 1 hour, 6 hours, then every 24 hours (only the first step was walked through); a balance below the amount without a floor shows "The team's PayPal balance is too low. Add funds, then retry."

### OUT-22: Payouts wait when a floor is set and the balance cannot be read

- **Actor:** team admin · **Surface:** web (`{dash}/walk-crew/payouts`) · **Delivered by:** R5b-1 (`a4cf6a8`) · **Status:** Built (not walked through)
- **Preconditions:** automatic payouts on with a connection that cannot read the balance (OUT-05 before reconnecting); a floor set.
- **Steps:**
  1. Approve a request.
- **Expected:**
  - The row waits with "Turn on automatic payouts again so Payleor can read your PayPal balance." and a next try.
  - Auto-approval rules do not approve payouts while the balance is unreadable.
- **Edge cases:** without a floor the payout sends, and PayPal's insufficient-funds refusal still holds it (OUT-11).

### OUT-23: Members are refused below the team minimum

- **Actor:** freelancer · **Surface:** web (`{dash}/me/payouts`) · **Delivered by:** R5b-1 (`a4cf6a8`) · **Status:** Built (not walked through)
- **Preconditions:** "Minimum payout (USD)" set to 50.00.
- **Steps:**
  1. Request $20.00.
- **Expected:**
  - The card shows "Payouts start at $50.00 for this team." and nothing is reserved.
- **Edge cases:** completed projects with earnings below the minimum get no automatic payout.

## PayPal Payouts Web

### OUT-24: Without automatic payouts, approved payouts wait for an export

- **Actor:** team admin · **Surface:** web (`{dash}/walk-crew/payouts`) · **Delivered by:** R5b-1 (`a4cf6a8`) · **Status:** Built
- **Preconditions:** automatic payouts off (OUT-06); a member request waiting.
- **Steps:**
  1. Approve the request as an admin who is not the payee.
- **Expected:**
  - The dialog reads "Approve $10.00 for {member}?" and "It waits for export or for automatic payouts."
  - The row shows "Approved, waiting to send" and "Waiting for export or for automatic payouts.", with **Reject** and no **Retry**.
  - Project payouts of a team with project payouts on are created and approved the same way and wait.
- **Edge cases:** the send sweep never retries these payouts.

### OUT-25: Admin exports approved payouts for PayPal Payouts Web

- **Actor:** team admin · **Surface:** web (`{dash}/walk-crew/payouts`) · **Delivered by:** R5b-1 (`a4cf6a8`), R5b-1 fixes (`2f2cb35`) · **Status:** Built
- **Preconditions:** OUT-24.
- **Steps:**
  1. In "PayPal Payouts Web", keep the payout ticked under "Approved payouts".
  2. Click **Export for PayPal Payouts Web**.
- **Expected:**
  - Each payout line shows the member, the amount and "Sends {amount} after PayPal's fee (about)" once an estimate exists.
  - The section lists the steps "In PayPal, open Pay & Get Paid > Payouts.", "Upload this file and send the payout." and "When it shows Processed, open it under Activity and choose Download > Download (CSV)." and the note "Your PayPal account needs Payouts turned on. PayPal charges its fee to your account; Payleor takes it from the member's payout, as with automatic payouts."
  - The browser downloads `payleor-payouts-{YYYY-MM-DD}.csv` with one line per payout and no header: payer ID, the amount less the fee estimate, currency, a reference starting with `PL`, "Payout from Walk Crew via Payleor", `PAYPAL`.
  - The row becomes "Sent through PayPal Payouts Web" with **Cancel export**.
- **Edge cases:** "No approved payouts to export." when none qualify; payouts before their payday, unconfirmed or flagged for review are not offered; mixed currencies: "Export one currency at a time."; with automatic payouts on, the section is hidden and the API refuses with "Automatic payouts send these for you.".

### OUT-26: Admin imports PayPal's CSV log and the payouts settle

- **Actor:** team admin · **Surface:** PayPal sandbox, web (`{dash}/walk-crew/payouts`) · **Delivered by:** R5b-1 (`a4cf6a8`), R5b-1 fixes (`2f2cb35`) · **Status:** Built
- **Preconditions:** an exported payout (OUT-25).
- **Steps:**
  1. [human] Log in to the PayPal sandbox as the PayPal seller, upload the file under Pay & Get Paid > Payouts, send it, wait for Processed, and download the payout's CSV log.
  2. Under "Import PayPal's CSV log", choose the downloaded file.
  3. Import the same file again.
- **Expected:**
  - Step 2 shows "1 settled, 0 failed, 0 still pending, 0 not matched."; the row shows "Paid" with "Sent {amount}" and "PayPal's fee {fee}" from the log; the ledger gets the same postings as OUT-10.
  - Step 3 shows "1 settled, 0 failed, 0 still pending, 0 not matched." again and adds no postings.
- **Edge cases:** a file without the reference column: "This file has no Customer ID column. Download the payout's CSV log from PayPal."; failed rows release the amount to the member; pending rows stay exported; a row with another amount adds "{n} did not match the exported amount; check them in PayPal."; a payout paid twice adds "{n} were paid twice; recover the extra payment in PayPal.". PayPal refuses automated uploads, so step 1 stays human.

### OUT-27: Admin cancels an export

- **Actor:** team admin · **Surface:** web (`{dash}/walk-crew/payouts`) · **Delivered by:** R5b-1 (`a4cf6a8`) · **Status:** Built (not walked through)
- **Preconditions:** a payout "Sent through PayPal Payouts Web" whose file was not sent in PayPal.
- **Steps:**
  1. Click **Cancel export** and confirm.
- **Expected:**
  - The dialog reads "Cancel the export of {amount} for {member}?" and "Only cancel if you did not send this file in PayPal. If PayPal already paid it, importing PayPal's log still settles it."
  - The row goes back to "Approved, waiting to send" and is offered for export again with the same reference.
- **Edge cases:** importing the cancelled file's log later still settles it; a log showing the cancelled export as pending flags the payout with "PayPal shows this cancelled export as pending. Check PayPal before paying it again." and blocks sending until settled or rejected.

## Member and team views

### OUT-28: Member payout history

- **Actor:** freelancer · **Surface:** web (`{dash}/me/payouts`) · **Delivered by:** R5c (`b437e78`), R5b-1 (`a4cf6a8`) · **Status:** Built
- **Preconditions:** payouts in several states for the member (OUT-07 to OUT-17).
- **Steps:**
  1. Open `{dash}/me/payouts` and read "History".
- **Expected:**
  - Each entry shows "{team} · {amount}" and one of "Waiting for approval", "Approved, being sent", "Paid", "Failed" or "Rejected" (holds, payday waits and exports all read "Approved, being sent").
  - Requests show "Requested {date}"; project payouts show "For {project}" and "Created {date}".
  - Sent and paid payouts show "Sent {amount}"; paid ones show "PayPal's fee {fee}" (at most the estimate kept back); failed ones show the reason.
- **Edge cases:** with no payouts: "No payout requests yet."

### OUT-29: Only team admins manage payouts

- **Actor:** freelancer, solo seller · **Surface:** web · **Delivered by:** R5c (`b437e78`), R5b-1 (`a4cf6a8`) · **Status:** Built (not walked through)
- **Preconditions:** a walk-crew member with the freelancer role; the `walk-crew-solo` owner.
- **Steps:**
  1. As the freelancer, open `{dash}/walk-crew/payouts`.
  2. As the solo seller, open `{dash}/walk-crew-solo/payouts`.
- **Expected:**
  - Step 1: "Only an admin can manage payouts. You can ask for a payout of your own earnings on your Payouts page." with a link to `/me/payouts`.
  - Step 2: "Payouts are for teams. As a solo seller, clients pay you directly in your PayPal account." The solo setup checklist has no "Turn on automatic payouts" step.
- **Edge cases:** the payouts API refuses non-admins with "Only an admin can approve payouts." (requests, export, import) or "Only an admin can change the team settings." (connection and rules).
