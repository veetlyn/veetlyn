# Contextual dashboard prototypes

Updated 2026-10-28 after the independent [use-case review](../platform/2026-10-28-contextual-agent-use-cases-review.md). These are local HTML prototypes, not production surfaces or proof of an implemented agent harness. The current [design](../platform/2026-10-27-calls-and-agent-design.md) owns the operating-model contract and user-type behavior.

## What this pass changes

- Keeps the existing Cal Sans/Inter, light relief, small radii and selected-row treatment.
- Uses Operating model and business words in the interface. The mode indication is read-only; it does not change a team's real automation.
- Shares one payout fixture between the call and the table through [dash-demo.js](dash-demo.js). Three reviewed requests total $640: $468 awaiting approval and $172 held after a destination change. A separate $95 request is outside this approval review. Ten paid October rows total $2,140.
- Keeps Baobab (PRJ-1042) in client review, separate from Aicha's completed Bakery website project and its $180 payout request. Baobab has $300 of work plus a $30 management fee, $330 captured, no balance/refund owed, and a prospective $180 member share that is not yet available.
- Reviews the exact selected gross amount and recipients; the preview explains that the first of two approvals does not send money. It does not record approval or call an API. The fixture's existing scheduled run is Friday 00:00 UTC, subject to approvals and checks; this is not a new scheduler implementation.
- Shows the outgoing note and its audience before preview. No message is sent.
- Uses real search, filter buttons, checkboxes, load-more and named multiline controls. The approval selection excludes held, unrelated requested and paid rows. Changing selection updates the amount/names; filtering does not silently change a selected proposal.
- Uses one project name, readable operating-model explanations and Paid dates rather than provider ids in Next step. Additional project facts are disclosed under Project details.

## Verification in this session

- `node --check specs/hackathon/dash-demo.js`: passed.
- `pnpm exec oxlint specs/hackathon/dash-demo.js`: passed without warnings after corrections.
- Browser: Chrome DevTools at its existing **1374 × 582 CSS-pixel** viewport, no window resizing. The T3 snapshot tool timed out twice before this fallback.
- Checked the payout view, call and Baobab record visually at that viewport. Root page width matched viewport width; content remains scrollable.
- Real pointer selection changed $468 / two payouts to $180 / one payout. Approval preview named Aicha, the exact amount, second-approver wait and scheduled effect. Closing left it unapproved.
- Paid filter initially showed 7 of 10; Show more exposed all ten rows, summing to $2,140. Search for Kofi returned one disabled approval checkbox; a missing query showed an empty result. The default table explicitly says 7 of 14 rows shown.
- The Ask about this shortcut focused the composer. Shift+Enter inserted a newline without opening a preview; Enter opened a local message preview; Escape closed it. A real Tab press reached a control with a computed solid 2px focus outline. No application request was made by these interactions.
- Measured the rendered muted-text token against canvas, context, field and white surfaces: 5.53:1, 5.63:1, 5.35:1 and 6.03:1 respectively. This is a scoped token/surface check, not a full accessibility audit.

## Limits

The prototypes do not implement business authorization, payments, messages, shared-call audiences, persistent context, file/voice tools or model calls. Unimplemented file/mention/voice controls are disabled. Bring in is only a preview of its privacy explanation; the project link returns to the call fixture. The other existing navigation/actions remain visual samples.

No phone-width, full keyboard-flow, screen-reader, reduced-motion, loading/error, event-timing or deployed-runtime audit was performed. Do not mark AGT runtime stories verified from these pages. Source findings on rival quote projection, payout routing, pinned deadlines and abandoned conversations remain open in BACKLOG.

## Context panel and hierarchy (2026-10-28)

From the screenshot study (`/tmp/veetlyn-seeds-screen-distillation.md`, 87 references) and Mouhamed's "no card at all" for the right panel:

- The panel's top is unboxed: a heading, one state line and two or three facts that decide the action. No background, border or shadow.
- Everything else sits below in plain sections. History and secondary rules ("Done so far", "Operating model", the money breakdown) are behind named disclosures.
- The panel closes from its head and reopens from the top bar, so the work gets the width back.
- Payouts shows one lead figure (the amount awaiting approval) and a quiet line for the rest, instead of a strip of four figures above the table.
- A figure appears large once per screen; the panel repeats it at body size.
- Table rows are 44px.
