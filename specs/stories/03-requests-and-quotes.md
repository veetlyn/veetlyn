# Requests and quotes (QUO)

The public quote request form and its limits, projects started by the team, assignment, quotes, the client's acceptance, the quote calculator, and amendments. Paying the deposit, top-ups and the balance is in `04-payments.md`; deliveries are in `05-delivery-and-completion.md`. Hosts, accounts and the story format are in [`README.md`](README.md).

Requests from the same client email count against the limits in QUO-06 and QUO-07; use a fresh plus address per run, or close old walkthrough projects first.

### QUO-01: A client opens the request form from a service

- **Actor:** client · **Surface:** web (`{seller}/request`) · **Delivered by:** R3c (`8d51ff2`) · **Status:** Built
- **Preconditions:** `walk-crew` published with at least one service that has intake questions (CAT-07).
- **Steps:**
  1. On `{seller}` for `walk-crew`, click **Request a quote** on a service.
  2. Fill everything except "Your name" with only spaces, then **Send request**.
- **Expected:**
  - The page is titled "Request a quote from Walk Crew" with the service's "Usually <price> · <days>" line.
  - "Service" has the service preselected; the other choices are the active services and "Something else".
  - The fields are "What do you need?", one field per intake question, "Your name" and "Your email".
  - Step 2 shows "Tell us your name." and sends nothing.
- **Edge cases:** an empty required field is stopped by the browser's own prompt first; a description under 10 characters shows "Describe what you need in at least a sentence."; an unanswered question shows "Answer every question or remove it."; a hidden service's id in `?offering=` falls back to "Something else".

### QUO-02: A client sends a quote request

- **Actor:** client · **Surface:** web (`{seller}/request`) · **Delivered by:** R3c (`8d51ff2`) · **Status:** Built
- **Preconditions:** QUO-01's form; a client address the tester reads (for example `tester+client1@example.com`) with fewer than 3 open requests to `walk-crew`.
- **Steps:**
  1. Fill the description (a sentence), the answers, "Walk Client" as name and the client address, then **Send request**.
- **Expected:**
  - The page shows "Request sent" and "We emailed <client address> a link to your page. It is how you follow the request and answer the team."
  - On `{dash}/walk-crew/projects`, a new project titled after the service, status "Quoting", with the client's email.
  - The client email (QUO-03) and the team notice (QUO-04) are sent.
- **Edge cases:** if the client email cannot be sent, the page shows "We could not send the email. Try again in a moment." and the project still exists for the team.

### QUO-03: The client gets a private link to their project

- **Actor:** client · **Surface:** email, web (`{seller}/c/<token>`) · **Delivered by:** R3c (`8d51ff2`); client page from S4 (`eb3b570`) · **Status:** Built (not walked through since the client and pay pages moved to `{seller}` in C)
- **Preconditions:** QUO-02 done.
- **Steps:**
  1. Open the email "Your request to Walk Crew" in the client's inbox.
  2. Click **Open your page**.
- **Expected:**
  - The sender is "Walk Crew via Payleor" at `invoices@payleor.com`, with reply-to the team's support email.
  - The email says "Walk Crew received your request. Follow it, and accept or discuss the quote, on your private page:" and links to `{seller}/c/<token>`.
  - The client page shows the project title, "Quoting", the description, and under "Quotes": "The team is preparing your quote." No account is needed.
- **Edge cases:** a changed or made-up token shows "This link is not valid" and "Ask the team to send you the project link again."; the link never expires.

### QUO-04: The team is told about the request

- **Actor:** team admin · **Surface:** email, web (`{dash}/walk-crew/projects/<id>`) · **Delivered by:** R3c (`8d51ff2`) · **Status:** Built
- **Preconditions:** QUO-02 done. The notice goes to the team's support email (`walk-crew@example.com`), which the usual AgentMail key cannot read; in R3c it was checked by pointing the support email at a readable inbox for one request.
- **Steps:**
  1. Open the email "New request from Walk Client" at the support address.
  2. Click **Open the project** and sign in as a team admin.
- **Expected:**
  - The email says "Walk Client (<client address>) asks about <service>:", then the description and each question with its answer.
  - The project page shows a "Request" section with "Requested by Walk Client <client address>" and the questions and answers, then the description and the "Client link".
- **Edge cases:** a seller with no support email gets no notice; the request still succeeds.

### QUO-05: A client asks for something not on the list

- **Actor:** client · **Surface:** web (`{seller}/request`) · **Delivered by:** R3c (`8d51ff2`) · **Status:** Built
- **Preconditions:** `walk-crew` published.
- **Steps:**
  1. On the seller page, click **Request a quote** in "Looking for something else? Request a quote".
  2. Leave "Service" on **Something else**, fill the form and send it.
- **Expected:**
  - No question fields and no "Usually" line.
  - The project is created with the title "Something else" and status "Quoting"; the team notice says the client "asks about Something else".
- **Edge cases:** none.

### QUO-06: A client cannot have more than 3 open requests with a team

- **Actor:** client · **Surface:** web (`{seller}/request`) · **Delivered by:** R3c (`8d51ff2`); race-safe since B2 (`eed3537`) · **Status:** Built
- **Preconditions:** a client address with no open request to `walk-crew`.
- **Steps:**
  1. Send three valid requests with that address.
  2. Send a fourth.
- **Expected:**
  - The first three show "Request sent".
  - The fourth shows "You already have 3 open requests with this team. Wait for an answer before sending another." and creates no project.
- **Edge cases:** only projects that came from the request form count, from quoting until the balance is paid; a completed or cancelled one frees a place, and projects the team started (QUO-10) never count. Afterwards, delete or finish the extra walkthrough projects.

### QUO-07: Invalid requests do not use up a client's hourly limit

- **Actor:** client · **Surface:** web (`{seller}/request`) · **Delivered by:** R3c (`8d51ff2`), B2 (`eed3537`) · **Status:** Built
- **Preconditions:** a client address with no open request to `walk-crew` and no request in the last hour.
- **Steps:**
  1. Send five requests with that address and a description shorter than 10 characters (fill it past the browser's check with a few letters).
  2. Send a valid request with the same address.
- **Expected:**
  - Each of the five shows "Describe what you need in at least a sentence."
  - The valid request shows "Request sent".
- **Edge cases:** more than 5 valid requests from one email to one seller within an hour, or more than 20 from one IP address, show "Too many requests. Wait a little and try again." (not walked through; QUO-06 usually stops a client first).

### QUO-08: Bots filling the hidden field get a fake success

- **Actor:** bot · **Surface:** api (`/trpc/project.requestQuote` on `{seller}`) · **Delivered by:** R3c (`8d51ff2`) · **Status:** Built
- **Preconditions:** `walk-crew` published; note the number of projects on `{dash}/walk-crew/projects`.
- **Steps:**
  1. From the browser console on `{seller}` for `walk-crew`, post a valid request to `/trpc/project.requestQuote` with `"website": "https://spam.example"`.
- **Expected:**
  - The answer is `{ ok: true }`.
  - No project is created and no email is sent.
- **Edge cases:** the hidden field is not reachable by keyboard or screen readers.

### QUO-09: A draft seller takes no requests

- **Actor:** client · **Surface:** web (`{seller}/request`) · **Delivered by:** R3c (`8d51ff2`) · **Status:** Built
- **Preconditions:** a draft seller (for example one from ACC-08).
- **Steps:**
  1. Open `/request` on its public address.
- **Expected:**
  - A not-found page (HTTP 404).
- **Edge cases:** a direct `project.requestQuote` call with the draft's slug answers "Seller not found."

### QUO-10: A manager starts a project for a client

- **Actor:** team admin or manager · **Surface:** web (`{dash}/walk-crew/projects/new`) · **Delivered by:** S4 (`eb3b570`); service picker from R3a (`444c1f4`) · **Status:** Built (not walked through since the client and pay pages moved to `{seller}` in C)
- **Preconditions:** signed in as the Team admin.
- **Steps:**
  1. Open **Projects** > **New project**.
  2. Fill "Title", pick a "Service" (or "Not one of my services"), "Client email" and "Brief", then **Start project**.
- **Expected:**
  - The form says "The client gets a private link to follow the project, accept quotes and pay. No account needed."
  - The browser lands on the project page: status "Quoting", the client's email, the brief, and "Client link: `{seller}/c/<token>`".
  - The project appears in the Projects list with status "Quoting".
  - No email goes to the client; the team shares the client link itself.
- **Edge cases:** **Start project** stays disabled until the title has 3 characters and an email or a Discord user ID is given; a freelancer who submits the form sees "Only admins and managers start projects." (not walked through).

### QUO-11: A manager assigns a freelancer, who quotes

- **Actor:** team admin, freelancer · **Surface:** web (`{dash}/walk-crew/projects/<id>`) · **Delivered by:** S4 (`eb3b570`); refusal hint from E7 (`908e709`) · **Status:** Built
- **Preconditions:** a `walk-crew` project in "Quoting" (QUO-02 or QUO-10); `walk-crew` in "Assigned quotes" mode.
- **Steps:**
  1. Open the project before assigning anyone and look at "New quote".
  2. Under "Assignment", choose "Walk Through (admin)" and click **Assign**.
  3. In "New quote", fill two lines (description and amount), keep "Delivery days" at 14, then **Send quote**.
- **Expected:**
  - Step 1: **Send quote** is disabled and the form says "Assign a freelancer first; in this team the assigned freelancer quotes."
  - The form shows "Total <sum>" as lines are typed, and a quote calculator (QUO-14).
  - After sending: a card "Quote v1 · <total>" with status "Sent", its lines and "Delivery in 14 days after the deposit."
  - The client page shows the quote as "<total> · delivery in 14 days" with "Waiting for you" and **Accept quote**.
- **Edge cases:** a line without a description or amount shows "Each line needs a description and an amount above zero."; several quotes may be sent before the client answers. "Open quotes" and "Team quotes" add a "Freelancer" choice for staff, and in "Team quotes" a freelancer cannot quote (not walked through).

### QUO-12: A solo seller quotes without assigning anyone

- **Actor:** solo seller · **Surface:** web (`{dash}/<slug>/projects/<id>`) · **Delivered by:** R3a (`444c1f4`); assign refused for solo in R3b (`29b6188`) · **Status:** Built
- **Preconditions:** a solo seller (ACC-08) with a project in "Quoting" (QUO-10).
- **Steps:**
  1. Open the project.
  2. Fill one quote line and **Send quote**.
- **Expected:**
  - There is no "Assignment" section and no quote calculator.
  - The quote is sent at once ("Quote v1", "Sent") and appears on the client page with **Accept quote**.
- **Edge cases:** a direct `project.assign` call answers "A solo seller does the work; there is no one to assign."

### QUO-13: The client accepts a quote

- **Actor:** client · **Surface:** web (`{seller}/c/<token>`) · **Delivered by:** S4 (`eb3b570`); pages refresh on their own since B1 (`46cb788`) · **Status:** Built (not walked through since the client and pay pages moved to `{seller}` in C)
- **Preconditions:** a `walk-crew` project with a proposed quote (QUO-11), for example $200 with a 10% management fee.
- **Steps:**
  1. On the client page, click **Accept quote**.
  2. Watch the team's project page (already open) for up to 15 seconds.
- **Expected:**
  - The client page shows "Awaiting deposit", the quote's status "accepted", and a "Payments" section: "Deposit" with "Deposit (50% of the quote)" $100.00, "Management fee (10%)" $20.00, "Total" $120.00 and **Pay with PayPal** (paying is PAY-01).
  - Other proposed quotes on the project become "superseded".
  - The team's page updates without a reload: "Awaiting deposit", and under Payments "Waiting for the client to pay."
  - The quote's freelancer becomes the assigned freelancer.
- **Edge cases:** accepting a quote that is no longer proposed answers "This quote is not waiting for an answer."

### QUO-14: The quote calculator works back from a member's pay

- **Actor:** team admin · **Surface:** web (project page, "New quote") · **Delivered by:** R5b-1 (`a4cf6a8`) · **Status:** Built
- **Preconditions:** a `walk-crew` project in "Quoting" with no one assigned; the "New quote" form has one line.
- **Steps:**
  1. In "Quote calculator", type `85` in "The member should receive (USD)".
  2. Click **Use this quote**.
- **Expected:**
  - "Quote $102.05" (at walk-crew's 15% cut and 10% fee, team plan) and the lines "Client pays …", "PayPal's checkout fee (about) …, paid by the team", "Payleor's fee …", "Team keeps …", "PayPal's payout fee (about) …" and "Member receives $85.00". In R5b-1 these were $112.26, $4.41, $1.12, $19.99, $1.74 and $85.00.
  - Line 1's amount becomes 102.05.
  - Pressing Enter in the calculator does not send the quote.
- **Edge cases:** text that is not an amount shows "Enter what the member should receive."; with two or more lines there is no **Use this quote** button; the payout fee uses the international estimate until a payee with a PayPal country is known.

### QUO-15: The team lowers the price with an amendment

- **Actor:** team admin, client · **Surface:** web (project page, `{seller}/c/<token>`) · **Delivered by:** S4 (`eb3b570`) · **Status:** Built (not walked through since the client and pay pages moved to `{seller}` in C)
- **Preconditions:** a `walk-crew` project "In progress" (deposit paid, PAY-01) with an accepted quote of at least two lines, no pending amendment.
- **Steps:**
  1. On the project page, under "Propose an amendment", tick **Remove "<a line>"**, click **Add a line** and add a cheaper line, write a "Note for the client", then **Propose amendment**.
  2. On the client page, click **Accept amendment**.
- **Expected:**
  - The team page lists the amendment as "<change> → <new total>" with status "Waiting", and the form disappears while it waits.
  - The client page shows "Amendments" with "<change> → new total <amount>", the added lines, the note, "Waiting for you", **Accept amendment** and **Decline**.
  - After acceptance: the amendment reads "accepted"; the team page shows "Quote v2" accepted and v1 "superseded"; no new payment is created, and the overpaid management fee counts toward the balance.
- **Edge cases:** while an amendment waits, the client cannot accept a delivery ("An amendment is waiting for the client's answer."); removing every line shows "An amendment cannot remove every line. Cancel the project instead."; a freelancer who is not assigned cannot propose ("Only the assigned freelancer or a manager proposes amendments.").

### QUO-16: An amendment that raises the price creates a top-up; the client can decline

- **Actor:** team admin, client · **Surface:** web (project page, `{seller}/c/<token>`) · **Delivered by:** S4 (`eb3b570`) · **Status:** Built (not walked through since the client and pay pages moved to `{seller}` in C)
- **Preconditions:** a `walk-crew` project "In progress" with an accepted quote and no pending amendment.
- **Steps:**
  1. Propose an amendment that adds a $400 line.
  2. On the client page, click **Accept amendment**.
  3. Propose another amendment and, on the client page, click **Decline**.
- **Expected:**
  - After step 2: "Quote v2" with the higher total, and a new "Top-up" payment with "Top-up (50% of the increase)" $200.00, "Management fee (10%)" $40.00, "Total" $240.00 and **Pay with PayPal**. The other half joins the balance.
  - Until the top-up is paid, a new amendment or accepting a delivery is refused with "The top-up for the last amendment is not paid yet."
  - After step 3: the amendment reads "declined" and the quote stays as it was.
- **Edge cases:** answering an amendment twice shows "This amendment is not waiting for an answer."
