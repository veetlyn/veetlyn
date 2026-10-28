# B1 staging walkthrough — 2026-10-27

Branch: `b1-operating-model`, latest deployed code `33df23b`. Parent plan: [B1 operating model](2026-10-22-b1-operating-model.md), Task 10. This records staging evidence; it does not mark the run merged or the security audit complete.

Earlier observations below come from this controller thread's browser, email and database checks on October 27. The resumed checks explicitly identify their additional evidence. No private client links, passwords or OAuth tokens belong in this file.

## Story evidence

| Story | Staging observation | Remaining coverage |
|---|---|---|
| AGT-16, notices | Request, quote, capture, delivery, late-refund, completion and refund emails arrived. Muted member deliveries were skipped while other recipients received theirs. | Failed-provider retry and duplicate-send protection have automated coverage; no provider failure was induced during the walkthrough. The entire quote-to-delivery lifecycle was not repeated for an AI-home client. |
| AGT-19, fulfilment | The seller/dash show fulfilment. Claude returned Walk Crew's Logo refresh as human-delivered. On resumption, ChatGPT returned the same offering as **By people** through the staging connector. | ChatGPT's stale widget definition initially returned HTTP 404. Reconnecting the existing account, refreshing tools and reloading produced **Opened Search offerings**, HTTP 200 and an embedded app frame. Checking the card found that it carried the fulfilment type but never drew it; only the model's text said it. `app-v7` now draws "By people", "Automated" or "People and automation" under the seller line. Verified by rendering the production widget code with real-shaped data for all three types in a local page, and by Claude displaying the cards from the redeployed staging connector. The label inside the host's sandboxed frame could not be read: the browser tool's snapshot times out on those frames in both Claude and ChatGPT. ChatGPT needs its tool definitions refreshed to pick up `app-v7`. |
| AGT-37, request expiry | The earlier Dakar Bikes request received its team reminder, expired, notified the client, and showed Expired on the client page. | The Claude-created request reached its deadline (see below). ChatGPT did not reread it, so the Expired plugin card was checked in Claude only. |
| AGT-46, versioning | Publishing v2 left older projects on v1 and pinned the new request to v2. The later plugin request pins temporary v3; restoring the normal response window published v4 without changing that pin. | No additional main-path check outstanding. |
| AGT-47, agreements/preferences | The seller form required its terms checkbox, recorded client acceptance of v2, and recorded Aicha's member acceptance. Disabling member emails persisted and produced skipped deliveries. | Non-admin member wording and persistent leaving-notice display were repaired during the walkthrough. |
| AGT-48, upfront tiers | The $200 quote collected $200 plus $20 management fee. The $1,200 quote collected $600 plus $120 management fee; accepting its delivery created a $600 balance. The fully prepaid Baobab project later completed without a balance payment. | The $600 balance checkout was not completed as part of this story's required awaiting-balance result. |
| AGT-49, revisions | One free change request succeeded; the next was refused. A $75 paid-revision amendment was offered and accepted. Mouhamed paid the corrected $82.50 top-up, including its fee. | The post-payment extra change-request edge is protected by tests; do not claim it was repeated in the browser. |
| AGT-50, lateness | Delivering three days late proposed $12 (3 × 2% of $200), recorded a mark and moved no money. An admin confirmed the reduction. | Waiving and zero-rate/on-time edges were not repeated live. |
| AGT-51, member updates | The reminder fired; the late-update mark became Aicha's third mark in the window and generated a strike warning/admin notice. Her 14-day leaving notice persisted. | Duplicate leaving notices were repaired with a regression; every new-work refusal was not repeated live. |
| AGT-52, silence | Bea received reminders at 11:41 and 11:51 UTC. Baobab auto-completed at 12:01, with final price $243: $275 less $12 late and $20 quality reductions. Team earnings $38.25 plus member earnings $204.75 equal $243. Mouhamed then sent the separate $32 refund; PayPal, ledger, email and both pages confirmed it at 18:32. | The abandon outcome and every client-activity cancellation edge were not walked live. |
| AGT-53, quality cap | A $60 reduction was refused at the delivered-stage $50 cap; $20 was accepted. | Cancellation before work is not implemented; other stage caps retain automated coverage. |
| AGT-54, PayPal dispute | Real sandbox dispute `PP-R-TYE-10194759` arrived by verified webhook, paused three review timers and emailed admins/the alert inbox. Mouhamed cancelled it; the resolved webhook recorded seller resolution and resumed the timers. The dashboard retained the resolved case card with a direct PayPal link. | A live payout refusal was not demonstrated because the member had no released earnings while the case was open. Router tests cover payout holds; production PayPal links were not tested. |

## Plugin expiry check, completed 2026-10-27

- Request: `c512f5aa-d66b-41d3-a3d5-eb9b69162e3d`, created through Claude at 18:53:04 UTC for Pain Doré.
- Pin: rulebook v3, response window two hours, reminder one hour before expiry.
- Team reminder due: **19:53:04 UTC**; request expiry due: **20:53:04 UTC**. The cron runs every ten minutes, so processing follows on the next tick.
- A resumed read-only database check confirmed both occurrences pending and the project quoting. Rulebook v4 restores the team's 48-hour window for new requests.
- Result: the scheduler ran the reminder at 20:00:54 and the expiry at 21:00:52 UTC (the next ticks after the due times). All three admin and member inboxes received "Answer soon" at 20:01; the client received "Your request to Walk Crew expired" at 21:00. The project is `expired`, pinned to v3.
- Claude, asked to check the request through the staging connector (`get_project`), reported it expired, with no quote accepted and nothing paid, and offered to search again. The rendered card was not captured: the browser snapshot timed out. ChatGPT was not asked to reread the request.

## Verification and remaining work

- Local full suite recorded **2,043 tests passing across 186 files** before the final MCP text fix; that fix's focused suite passed **8 tests**.
- CI on `33df23b`: passing. Resumed workspace type checks: **16/16 tasks successful**. Lint, no-brand, OSS boundary and whitespace checks: passing.
- `33df23b` puts the accepted rulebook ID into `get_request_terms` text, because Claude did not receive the ID from structured content alone. Request creation through Claude succeeded after deployment.
- Security run 5 remains an explicitly incomplete, scoped audit, as documented in the parent plan. Its deferred units and model-asserted consent lead remain visible; this walkthrough does not resolve them.
- Bea's client link, exposed once in the walkthrough transcript, was reissued from the dash ("Earlier links no longer work"); the old link now answers "This link is not valid".
- The staging admin and Ann Client (`stgc1`) passwords were reset during the walkthrough; the new ones are stored outside the repository.
- Before closing B1, on `main` after the merge: story statuses, backlog moves and PROGRESS (the process's Record step), then Mouhamed's merge decision. Do not archive the plan or mark B1 done before those steps.

## Incremental test audit

Reviewed all 15 test files changed from `84a3d43` through `33df23b`, extending the parent plan's earlier sweep. Kept the changes; no duplicate test was identified for removal in this increment.

- Draft/publication contention uses separate real database connections and asserts the published spec remains unchanged while a new draft retains the delayed edits.
- Payout regressions assert no provider payout after a dispute arrives during the balance lookup, and no CSV export/status change under an existing hold. These protect separate send paths.
- Pending-capture disputes and sub-millisecond scheduler deadlines exercise persisted boundary effects; they cover different ordering/precision failures from the earlier webhook and claim tests.
- Publishing accepts only the publisher; leaving notice preserves its original date and emits one mark/event on repetition. Existing UI fixtures were updated without replacing real persistence with a fake.
- Checkout tests distinguish full quote lines from partial-payment labels; router assertions additionally protect the actual provider request. Refund/dispute copy, environment-specific PayPal links, dispute selection/visibility and precise rule summaries protect public presentation contracts.
- The MCP text-ID assertion compares two representations of the same response. It protects the host-visible wire contract that failed in Claude; it is not a source-text assertion or a helper comparing its own result with itself.

No new production testing seam or extra runtime test was introduced by this audit. Historical red/green claims remain those recorded by the implementing controller; this incremental sweep was source review, with the existing green suite and CI as runtime evidence.
