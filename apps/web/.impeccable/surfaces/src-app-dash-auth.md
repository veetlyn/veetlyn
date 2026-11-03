---
version: 1
slug: "src-app-dash-auth"
primary_target: "src/app/dash/(auth)"
related_targets: ["src/components/auth"]
---

# Auth screens (log in, sign up, verify email, forgot and reset password)

Scope: `apps/web/src/app/dash/(auth)/*` and `components/auth/*`. Mode: operate. Audience: every role signing in or creating an account (sellers, members, clients with accounts). Job: get in, or create an account, in under a minute; constraint: one screen on a laptop, works on a 390px phone. Must keep: email/password, PayPal and Discord sign-in, terms notice, every current message.

## Direction contract

THESIS: Signing in is a moment to show the product working: beside the form, one real project flows from an AI request to a paid member. Refuses the decorative brand panel (the old Payleor "P" contours) and the bare centered card.

OWN-WORLD: The marketing site's world: Relief tokens, dark stage (#121215) with 24px radius, Cal Sans display at -0.03em, mint (#1fbf8f) only as signal and on the asymmetric 4px/999px pill, chat bubble and inset-1px stage cards, tabular numbers.

STORY: The visitor completes the form; the stage tells them in three beats what Veetlyn does with money: a client asks Claude, a quote is accepted with its deposit, a member is paid after approval. Labelled Example.

FIRST VIEWPORT: Left column: brand lockup and theme toggle top, the form centered at 380px, Cal Sans 40px title, mint pill submit, alternate sign-ins, footer links. Right (lg and up, 1.05fr): dark stage, kicker "Example · one project on Veetlyn", 30px headline, request bubble right-aligned, quote card with Quote/Deposit rows and an "Accept and pay deposit" pill, payout card "Paid $543.75". Phones: form only, the stage hidden.

FORM: Product proof stage, my ranked list position 2; seed:2bf081dd6f117104

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
