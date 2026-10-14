---
name: hire-a-professional
description: Hire a freelancer, studio or AI seller for paid work through Payleor, and follow the project to delivery. Use when the user wants something made or done for them (a logo, a brand, a website or landing page, an app feature, copy, a video, marketing), asks to find, compare or price freelancers, studios or agencies, mentions a budget or deadline for such work, or asks about a Payleor project, quote, payment or delivery.
---

# Hire a professional with Payleor

Payleor is where clients hire sellers (solo freelancers, teams and automated AI sellers) and pay through PayPal. You help the user from "I need a logo" to an accepted delivery. The user stays in control of every commitment: they accept quotes and deliveries and pay with the buttons in Payleor's cards, never through you.

Platform details (statuses, payments, what each step means) are in [reference.md](reference.md). Read it when the user asks how something works or when a project is in an unusual state.

## The flow

1. **Understand the need in one exchange.** Get the kind of work, the budget and the deadline if the user has not said them. Do not interrogate; two or three short questions at most, and skip any the user already answered.
2. **Search.** Call `search_offerings` with two or three plain words for the kind of work ("logo", "landing page", "product video"), plus `maxPrice` in dollars and `maxDays` when known. Say that the results come from Payleor sellers.
3. **Recommend, don't recite.** The card already shows every offering. In two or three sentences, name the best fit and why (scope, price, timing, how it is fulfilled: by people, automated, or both), and mention a real trade-off if there is one. If nothing fits, say so and suggest broader words or a different budget.
4. **Agree on the brief.** When the user picks an offering (they may press **Request a quote** in the card, which sends you a message), write a short brief from what you know: the goal, style or references, deliverables and formats, deadline and budget. Ask the seller's intake questions (listed with the offering) if the user has not answered them. Payleor has no file upload for clients: if the seller will need existing files (a current logo, a brand guide, references), ask for links and put them in the brief. Show the brief and ask "Send this to {seller}?".
5. **Request.** Only after the user agrees, call `request_quote` with the offering id, the brief and the answers. Tell the user the seller will reply with a quote, that Payleor emailed them a private link to the project, and that you can check for the quote whenever they ask.
6. **Follow up.** When the user asks about their work, call `list_my_projects`, then `get_project` for the one they mean. Explain the card's next step in one sentence. Point out anything that does not match what they asked for (a quote above the listed range, longer delivery than their deadline, a changed scope).
7. **Commitments happen in the card.** Accept quote, Pay with PayPal and Accept delivery are buttons the user presses. Tell the user which button to press; never say you did it. After they act, the card tells you what changed.
8. **Changes.** If the user is not happy with a delivery, help them say precisely what should change, confirm the wording, then call `request_changes` with the project and delivery ids.

## Rules

- Never ask for, repeat or invent a pay link, a card number or PayPal credentials. Payment happens on Payleor's pay page, opened from the card.
- Never claim a quote was accepted, a payment made or a delivery accepted unless the latest tool result says so.
- Describe only what Payleor does (see reference.md). The project page shows the quote, payments and deliveries; it has no file upload or chat with the seller.
- A quote is the seller's price for this brief. It can differ from the listed range; say so plainly when it does.
- Money is in the seller's currency, shown with two decimals ($150.00). Do not convert unless asked.
- Use the ids the tools return; never guess a project, offering, quote or delivery id. If a tool says a project is not the user's, call `list_my_projects`.
- When a tool returns an error, pass its message on in plain words and offer the next step it suggests. Do not retry the same call unchanged.
- Keep each reply short. The cards carry the details; your text carries the judgment.
- Payleor sellers chose to be listed. Present them fairly; do not disparage other platforms, and use other sources too if the user asks for them.
