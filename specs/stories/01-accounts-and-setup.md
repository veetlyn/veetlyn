# Accounts and setup (ACC)

The public site, sign-up and sign-in, email verification and password reset, creating a seller (solo or team), connecting PayPal, members and roles, and team settings. Hosts, accounts and the story format are in [`README.md`](README.md). The physical-goods store flow (Commerce, "Create your store") is not covered here.

### ACC-01: Visitor reads the index page

- **Actor:** visitor · **Surface:** web (`{site}/`) · **Delivered by:** L (branch `l-site`) · **Status:** Built on `l-site`, walked through 2026-10-20 (PR #7)
- **Preconditions:** none; not signed in.
- **Steps:**
  1. Open `{site}/` at 1280 wide and watch the chat card play; press **Play again**.
  2. Open the **Network** menu, then **Who it is for**; press Escape; open one and click outside it.
  3. Scroll to the end. Click **Get started**, then come back and click **Log in**.
  4. Repeat at 390 wide with the **Menu** button.
- **Expected:**
  - A dark band with "Sell where AI shops", the buttons "Start selling" (to `/pricing`) and "How Payleor Network works" (to `/network`), and "Clients add Payleor Network once, in Claude or ChatGPT."
  - The Claude card types "Find someone to design a logo for my bakery, under $900.", shows Logo Bot $29 and Walk Crew $400+, presses "Request a quote" into "Requested", shows Walk Crew's quote "Logo and brand kit, 10 days · deposit $384, $640", presses "Accept" into "Accepted", then "Accepted. Pay the deposit on Payleor, with PayPal." With reduced motion it shows the end state at once.
  - "Where clients find you" with ChatGPT, Claude, Perplexity, Gemini and Google, and "Paid through" PayPal, in monochrome.
  - Sections: "Agentic commerce, with a person on every payment" (three sides), "AI shopping left services out. Payleor Network brings them in.", "For anyone who sells" with four story cards to the audience pages, "Our terms, on top of every integration" (six terms), "Get found on search and in AI answers" (its note says web SEO comes to every seller page with run V; "We report what happened. We never promise rankings."), "Your clients stay yours. We charge when we bring you one." with "From $12 a month", "0.25–2%" and "5% once", "Money questions" (five, the first open) and "Be there when AI comes shopping".
  - The menus each show four illustrated tiles and a feature card; one opens at a time; Escape closes it and puts focus back on its button; a click outside closes it. The header has Pricing, Blog, Contact, "Log in" (`{dash}/login`) and "Get started" (`{dash}/signup`) and stays under the sandbox banner while scrolling.
  - Below 1140 wide the links fold into **Menu**: tiles for both menus, then Pricing, Blog, Contact and Log in.
  - The footer has Sell and Payleor columns, the examples note, the three legal links and "© 2026 Payleor".
- **Edge cases:** the deposit ($384), quote and plan figures are computed from `packages/core`; a price change in core changes the page.

### ACC-01b: Visitor compares plans on the pricing page

- **Actor:** visitor · **Surface:** web (`{site}/pricing`) · **Delivered by:** L · **Status:** Built on `l-site`, walked through 2026-10-20 (PR #7)
- **Preconditions:** none.
- **Steps:**
  1. Open `{site}/pricing`. Switch **Monthly** to **Yearly, 2 months free**, then **Services** to **Store**, then **Services + store**.
- **Expected:**
  - Services, monthly: Solo $19 with 1% on each client payment, Team $59 with 0.5%, Agency $199 with 0.25%, Enterprise "Custom" with "Talk to sales" (to `/contact#sales`). Yearly: $16, $49 and $166 a month, "Billed $192 a year" on Solo.
  - Store: Starter $12 with 2% on each order, Grow $39 with 1%, Scale $129 with 0.5% (yearly $9, $29, $99), and Enterprise.
  - Services + store hides the plan cards and shows "Run services and a store" with the bundle builder (ACC-01g); the services and store agent tables both show.
  - "Agents in every plan": intake drafts 50, 300, 1,500 and Custom; "Web SEO on every page" carries "Coming with run V". "Payleor Network: 5%, once", "Getting found" (Web SEO "Coming to every plan with run V", AI visibility "Network members · Waitlist", Self-hosted "Planned for 2027"), "Every plan includes our terms" with "14 days free, no setup fee", six questions.
- **Edge cases:** every price and fee is read from `SELLER_PLANS`, `PLANS` and `NETWORK_FEE_BPS`.

### ACC-01c: Visitor reads the Payleor Network page

- **Actor:** visitor · **Surface:** web (`{site}/network`) · **Delivered by:** L · **Status:** Built on `l-site`, walked through 2026-10-20 (PR #7)
- **Preconditions:** none.
- **Steps:**
  1. Open `{site}/network`, let the ChatGPT card play, scroll to the end and click **Join the waitlist**.
- **Expected:**
  - The card shows Walk Crew's delivery ("Logo, 3 directions", Ready) and "Balance due $320"; "Accept delivery" turns into "Accepted", then "Accepted. Pay the $320 balance on Payleor, with PayPal."
  - Six gaps, "What their AI can do, and what only the client can", "How clients add it" with `api.payleor.com/mcp` and the note that directory listings come after the platforms' review; nowhere says sellers are listed in Claude or ChatGPT.
  - Membership (`#membership`): how to qualify, what members get with "Planned, opening soon", the Maison Lune member card. **Join the waitlist** opens `/contact#membership` with the topic "Network membership" selected.
- **Edge cases:** none.

### ACC-01d: Visitor browses Discover

- **Actor:** visitor · **Surface:** web (`{site}/discover`) · **Delivered by:** L · **Status:** Built on `l-site`, walked through 2026-10-20 (PR #7)
- **Preconditions:** none.
- **Steps:**
  1. Open `{site}/discover?q=logo`. Clear the search, pick **Courses**, then **All**, **Done by: AI**, **Sort: Lowest price**; type "zzz".
- **Expected:**
  - With `?q=logo` the box reads "logo" and the grid shows 2 listings: "Logo and brand kit" (Walk Crew, with the member check) and "Logo ideas in a minute" (Logo Bot); the count reads "2 listings".
  - "Network members" shows four member listings; the result bar says "Sample listings while the network opens".
  - Courses shows the two courses; Done by AI shows Logo ideas in a minute and Deck translation; Lowest price orders by price, ties in featured order; "zzz" shows "0 listings" and "Nothing matches yet. Try another word or clear a filter."
  - The page's JSON-LD is a CollectionPage with no listing in it.
- **Edge cases:** the listings are samples until run V replaces them with the network's search.

### ACC-01e: Visitor reads Get found

- **Actor:** visitor · **Surface:** web (`{site}/visibility`) · **Delivered by:** L · **Status:** Built on `l-site`, walked through 2026-10-20 (PR #7)
- **Preconditions:** none.
- **Steps:**
  1. Open `{site}/visibility` and scroll to the end.
- **Expected:**
  - "Get found by Google and AI" with the answers card labelled "Example", then the logo strip.
  - "Web SEO for every plan": Structured data, Crawlers, Speed and Discover each carry "Coming with run V".
  - "AI visibility, for Network members" with "Planned" and nine items; "Nothing ships without your yes" in four steps; "We report what happened. We never promise rankings."; four questions.
- **Edge cases:** the run V labels come off when run V merges.

### ACC-01f: Visitor reads an audience page

- **Actor:** visitor · **Surface:** web (`{site}/freelancers`, `/agencies`, `/stores`, `/studios`) · **Delivered by:** L · **Status:** Built on `l-site`, walked through 2026-10-20 (PR #7)
- **Preconditions:** none.
- **Steps:**
  1. Open each page at 1280 wide and scroll through its story; repeat one at 390 wide.
- **Expected:**
  - Wide: the steps scroll beside a pinned scene that changes with the step nearest the middle; the rail fills. Phone: each step carries its own scene.
  - Freelancers: the deposit scene shows $320.00; the last scene "You kept $578.77" with PayPal $22.83 and "Payleor, 1% and 5% once" $38.40; cards Solo, Team, Enterprise.
  - Agencies: deposit $384.00 (half the quote $320.00, management fee $64.00), "Send $543.75 to Amadou?" with Walk Crew $131.42, PayPal $25.31, "Payleor, 0.5%" $3.52; cards Team, Agency, Enterprise.
  - Stores: "Takes 1%, nothing more"; "Clay Room's order: $65.00" with "Payleor, 1% on Grow" $0.65; cards Starter, Grow, Scale, Enterprise.
  - Studios: "A week at Maison Lune" with the deposit $22.50 and "Send $26.75 to Inès?" (Maison Lune $13.45, PayPal $2.32, Payleor $2.48), "One link for your bio and every chat", and the bundle builder.
- **Edge cases:** the splits are computed from core (`apps/web/src/lib/site/examples.ts`, tested); a fee change fails that test.

### ACC-01g: Visitor uses the fee calculator and the bundle builder

- **Actor:** visitor · **Surface:** web (`{site}/pricing`, `{site}/studios`) · **Delivered by:** L · **Status:** Built on `l-site`, walked through 2026-10-20 (PR #7)
- **Preconditions:** none.
- **Steps:**
  1. On `/pricing`, read the calculator, press **Your own client**, then switch to **Store**, pick Grow and type 120.
  2. Switch to **Services + store**, then **Yearly**.
- **Expected:**
  - Default (Team, $640, Found through AI): "0.5% payment fee $3.20", "5% network fee, first project $32.00", "Payleor $35.20" and "The next project with this client: 0.5% only." Your own client: the network line is $0.00 and the note reads "Your own clients never pay the network fee."
  - Store, Grow, 120: "1% order fee $1.20", "Payleor $1.20", "PayPal's own fee is separate."
  - Bundle (Team + Grow): "Team $59.00", "Grow, half price $19.50", "A month $78.50", "Every payment and order pays 0.5%, the lower fee." Yearly: $49.00 + $14.50 = $63.50.
- **Edge cases:** an empty or invalid amount shows $0.00 lines.

### ACC-01h: Visitor writes to sales

- **Actor:** visitor · **Surface:** web (`{site}/contact`) · **Delivered by:** L · **Status:** Built on `l-site`, walked through 2026-10-20 (PR #7)
- **Preconditions:** a mail app on the device.
- **Steps:**
  1. Open `{site}/contact#sales`, then `{site}/contact#membership`. Fill name, email, company and message and press **Write the email**.
- **Expected:**
  - `#sales` selects "Enterprise and sales"; `#membership` selects "Network membership".
  - The mail app opens a message to contact@payleor.com with the subject "<topic>: <company>" and a body with name, company, what they sell, team size and the message. Nothing is sent from the page.
- **Edge cases:** without a company the subject uses the name.

### ACC-01i: Visitor reads the blog

- **Actor:** visitor · **Surface:** web (`{site}/blog`, `{site}/blog/<slug>`) · **Delivered by:** L · **Status:** Built on `l-site`, walked through 2026-10-20 (PR #7)
- **Preconditions:** none.
- **Steps:**
  1. Open `{site}/blog`, pick **For stores**, then **All**. Open `{site}/blog#visibility`.
  2. Open "How to get found on Google and in AI answers, without ads" and scroll to the end. Open `{site}/blog/unknown`.
- **Expected:**
  - Six articles, the first as the feature card; a topic shows only its articles; `#visibility` opens on Getting found.
  - The article: breadcrumbs Blog / Getting found, "October 19, 2026 · 2 min read · The Payleor team", the illustration, "In short", the body (its "What Payleor does for you" section says web SEO comes to every plan with run V), Questions, the call to action and "Keep reading" with three other articles.
  - An unknown slug is a 404.
- **Edge cases:** none.

### ACC-01j: Crawlers read the site

- **Actor:** crawler · **Surface:** web (`{site}/sitemap.xml`, `/robots.txt`, `/llms.txt`, every page) · **Delivered by:** L · **Status:** Built on `l-site`, walked through 2026-10-20 (PR #7)
- **Preconditions:** none.
- **Steps:**
  1. Fetch the three files on `{site}`. On each page, parse every `<script type="application/ld+json">`.
- **Expected:**
  - The sitemap lists 17 URLs on `https://payleor.com` (11 pages and 6 articles); robots allows `*` and names GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, Claude-User, PerplexityBot and Google-Extended, with the sitemap line; llms.txt starts with "# Payleor" and links every page and article.
  - Each page has one JSON-LD graph that parses: Organization plus WebSite with a SearchAction to `/discover?q=` and FAQPage on the index; BreadcrumbList on the others, with FAQPage where the page has questions, SoftwareApplication offers on pricing, CollectionPage on Discover, Blog on the blog, BlogPosting on articles. Each page has a description and a canonical URL on `https://payleor.com`.
- **Edge cases:** on `{dash}` the three files redirect to the login page, and seller hosts have none; seller-page robots and sitemaps come with run V.

### ACC-02: Visitor reads the platform legal pages

- **Actor:** visitor · **Surface:** web (`{site}/legal/*`) · **Delivered by:** W1-D (`a8e5260`), footer by L · **Status:** Built (walked through 2026-10-20)
- **Preconditions:** none.
- **Steps:**
  1. On `{site}/`, use the footer links "Terms of service", "Privacy policy" and "Acceptable use policy".
- **Expected:**
  - Each page has its title, "Last updated October 5, 2026", and ends with "This text is a template and is not legal advice."
  - The Terms name Mouhamed Bakhoum as the operator, Senegalese law and the courts of Dakar.
  - The footer on every `{site}` page shows the three links, `contact@payleor.com` and "© 2026 Payleor".
- **Edge cases:** none.

### ACC-03: Every page shows the sandbox banner

- **Actor:** anyone · **Surface:** web (all hosts) · **Delivered by:** W1-D (`a8e5260`) · **Status:** Built
- **Preconditions:** none.
- **Steps:**
  1. Open `{site}/`, `{dash}/login` and a published seller page (`{seller}` for `walk-crew`).
  2. Scroll down on each.
- **Expected:**
  - A banner at the top reads "Sandbox: payments use PayPal test accounts. No real money moves."
  - It stays at the top while scrolling and has no close button.
- **Edge cases:** the checkout variant with the sandbox buyer login and a test card exists in code, but no page renders it today; the pay page and store checkout show the default text.

### ACC-04: Someone signs up with email and verifies the address

- **Actor:** new user · **Surface:** web (`{dash}/signup`, `{dash}/verify-email`), email · **Delivered by:** W1-D (`a8e5260`) · **Status:** Built
- **Preconditions:** an email address nobody has used on Payleor (an AgentMail plus address, for example `tester+acc04@example.com`).
- **Steps:**
  1. Open `{dash}/signup`. Fill "Your name", "Email" and a "Password" of at least 10 characters, then **Create account**.
  2. Open the email "Verify your email for Payleor" and click **Verify email**.
- **Expected:**
  - The sign-in pages (sign-up, log in, forgot password, reset password, verify email) fill the window without scrolling: the form on the left with the Payleor mark and the theme switch, the Payleor P drawn as contour lines on the right (hidden on phones), and no dash header.
  - The sign-up page is titled "Create your Payleor account" with "Free for 14 days. No setup fee." and the notice "By continuing you agree to the Terms of service and the Acceptable use policy" linking to `{site}/legal/…`.
  - After submit, `{dash}/verify-email` shows "Check your inbox" and "We sent a link to <address>. Open it to verify your address. The link expires in 1 hour."
  - The resend button counts down ("Send a new link in 59s" …) and then reads "Send a new link"; clicking it shows "We sent a new link." and restarts the countdown.
  - The email comes from "Payleor" `accounts@payleor.com`.
  - The link signs the user in and lands on `{dash}/new` ("Create your store"), because the account has no seller yet.
- **Edge cases:** a password under 10 characters is refused by the form; logging in before verifying sends the user to `{dash}/verify-email` and emails a fresh link; more than 5 sign-ups a minute, or 3 resends in 10 minutes, show "Too many attempts. Try again in a few minutes." (rate limits not walked through). There is no link from `/new` to the services form; open `{dash}/new/services-team` directly (ACC-08).

### ACC-05: A user logs in and out

- **Actor:** team admin · **Surface:** web (`{dash}/login`) · **Delivered by:** W1-D (`a8e5260`); forms post before hydration since E3 (`219e6db`) · **Status:** Built
- **Preconditions:** the Team admin account with a known password (reset it with ACC-06 if needed).
- **Steps:**
  1. Open `{dash}/login` ("Log in to Payleor"), enter the email and password, then **Log in**.
  2. Open `{dash}/login` again while signed in.
  3. Open the user menu (the user's name, top right) and choose **Sign out**.
- **Expected:**
  - Step 1 lands on `{dash}/`, the workspace home (ACC-10).
  - Step 2 redirects to `{dash}/`.
  - The user menu lists the email, "Account settings", "Payouts" and "Sign out". After signing out, opening `{dash}/` redirects to `{dash}/login`.
- **Edge cases:** a wrong password shows an error under the form and stays on the page; the 6th attempt within a minute shows "Too many attempts. Try again in a few minutes." (not walked through).

### ACC-06: A user resets a forgotten password

- **Actor:** team admin · **Surface:** web (`{dash}/forgot-password`, `{dash}/reset-password`), email · **Delivered by:** W1-D (`a8e5260`) · **Status:** Built
- **Preconditions:** the Team admin account; access to its AgentMail inbox.
- **Steps:**
  1. On `{dash}/login`, click **Forgot your password?**, enter the email, then **Send reset link**.
  2. Open the email "Reset your Payleor password" and click **Choose a new password**.
  3. Enter a new password twice, then **Change password**.
  4. Log in with the new password.
- **Expected:**
  - Step 1 shows "If an account exists for <address>, we sent a link to reset your password. The link expires in 1 hour."
  - Step 3 lands on `{dash}/login` with "Your password was changed. Log in with your new password."
  - The new password works; other sessions of that user are signed out.
- **Edge cases:** an unknown email shows the same confirmation and sends nothing; two different passwords show "The passwords do not match."; a used, expired or missing token shows "This reset link is invalid or has expired." with "Get a new link"; a 4th request within 10 minutes shows "Too many attempts. Try again in a few minutes."

### ACC-07: Someone signs up or logs in with PayPal

- **Actor:** new user · **Surface:** web (`{dash}/signup`, `{dash}/login`), PayPal · **Delivered by:** W1-D (`a8e5260`) · **Status:** Built (not walked through)
- **Preconditions:** a PayPal sandbox personal account with no Payleor account yet.
- **Steps:**
  1. On `{dash}/signup`, click **Sign up with PayPal**.
  2. [human] Log in to the PayPal sandbox account and consent.
  3. Later, on `{dash}/login`, click **Log in with PayPal** and repeat step 2.
- **Expected:**
  - No verification email step: PayPal's verified email counts as verified.
  - With no seller yet, the user lands on `{dash}/new`.
  - Logging in with PayPal later opens the workspace home.
- **Edge cases:** PayPal needs an HTTPS return URL, so this only works on `{dash}`, not on localhost.

### ACC-08: A freelancer creates a solo seller ("Just me")

- **Actor:** solo seller · **Surface:** web (`{dash}/new/services-team`) · **Delivered by:** R3a (`444c1f4`); own workspace from B2 (`eed3537`) · **Status:** Built
- **Preconditions:** signed in (any verified account). Note: `walk-crew-solo` was switched to a team in the R3a walkthrough; `walk-b2-solo` (from B2) is a draft solo seller. Stories that need a solo seller can use one created here.
- **Steps:**
  1. Open `{dash}/new/services-team` ("Sell your services").
  2. Keep **Just me** selected, type a name; the address follows the name. Wait for the status line.
  3. Click **Create my seller page**.
- **Expected:**
  - "Just me" reads "You do the work and keep the whole price. No members, no payouts."
  - The status line shows "Checking the address…", then "<`{dash}`/address> is available."
  - The browser lands on `{dash}/<slug>`: the dashboard shows "Set up your seller page", the sidebar has Projects, Services and Settings but no Members or Payouts, and the header reads "Selling as just me".
  - The workspace home lists the seller under a new workspace of its own, labelled "Services team", role "Admin".
- **Edge cases:** an address in use shows "This team address is already taken."; a reserved one (for example `settings`) shows "This team address is reserved."; a bad format shows "Use 3 to 40 lowercase letters, numbers or single hyphens."; the button stays disabled until the address is available and the name has 2 characters.

### ACC-09: An owner creates a team seller ("A team")

- **Actor:** team admin · **Surface:** web (`{dash}/new/services-team`) · **Delivered by:** S1 (`6e79775`), R3a (`444c1f4`) · **Status:** Built
- **Preconditions:** signed in as the Team admin.
- **Steps:**
  1. Open `{dash}` and click **Create your services team**.
  2. Choose **A team**, enter a name and an available address, then **Create our team**.
- **Expected:**
  - "A team" reads "Members share the price: your team cut and a management fee apply."
  - The dashboard shows "Set up your team", and the sidebar adds Members and Payouts. The header reads "Selling as a team".
  - The team is created in the user's existing workspace and appears on the workspace home with role "Admin".
- **Edge cases:** the address `walk-crew` shows "This team address is already taken." (walked through in B2); stores and services teams share one address space.

### ACC-10: The workspace home lists the user's sellers

- **Actor:** team admin · **Surface:** web (`{dash}/`) · **Delivered by:** W1-D (`a8e5260`), S1 (`6e79775`) · **Status:** Built
- **Preconditions:** signed in as the Team admin.
- **Steps:**
  1. Open `{dash}/`.
  2. Click **Walk Crew**.
- **Expected:**
  - "Your workspace", with one section per workspace (by name) listing each seller: name, "Services team", and the user's role ("Admin", "Manager" or "Freelancer").
  - The buttons "Create your services team" (always) and "Create your store" (only for workspace owners and admins).
  - Clicking the name opens the seller dashboard at `{dash}/walk-crew`, with the Payleor mark at the top of the sidebar linking back to the workspace home.
- **Edge cases:** a user with no sellers is redirected to `{dash}/new`.

### ACC-11: The dashboard checklist tracks setup

- **Actor:** team admin, solo seller · **Surface:** web (`{dash}/<slug>`) · **Delivered by:** S1 (`6e79775`); service, publish and solo steps in R3a (`444c1f4`) and R3b (`29b6188`); "Turn on automatic payouts" in R5c (`b437e78`) · **Status:** Built
- **Preconditions:** a new team seller (ACC-09) and a new solo seller (ACC-08).
- **Steps:**
  1. Open each dashboard and read the checklist.
  2. On the team seller, add a service (CAT-01) and save the settings (ACC-13), then reload.
- **Expected:**
  - Team: "Set up your team" with "Create your team" (done), "Add a service or a product", "Connect PayPal", "Set your rates", "Turn on automatic payouts", "Publish your seller page", "Link Discord", and "1 of 7 done".
  - Solo: "Set up your seller page" with "Create your seller page" (done), "Add a service or a product", "Connect PayPal", "Publish your seller page", "Link Discord", and "1 of 5 done".
  - After step 2, "Add a service or a product" and "Set your rates" are done and the count goes up by two.
  - "Connect PayPal" and "Publish your seller page" jump to the PayPal and Seller page cards on the same page.
- **Edge cases:** a hidden service still counts as added.

### ACC-12: An admin connects the seller's PayPal account

- **Actor:** team admin · **Surface:** web (dashboard "PayPal payments" card), PayPal · **Delivered by:** S3 (`6baf62c`); card on services dashboards in E5 (`864d141`), copy in E6 (`1c2e1b7`) · **Status:** Built
- **Preconditions:** a seller with no PayPal connection (ACC-08 or ACC-09), signed in as a workspace owner or admin.
- **Steps:**
  1. On the dashboard, the "PayPal payments" card shows "Not connected"; click **Connect PayPal**.
  2. [human] On the PayPal sandbox, log in as a sandbox business account and give consent.
  3. Back on the dashboard, read the card and the details list.
- **Expected:**
  - Before: "Not connected" and "Connect PayPal to accept payments."
  - After PayPal returns to `{dash}/<slug>`: "Connected" and "Payments are paid out to PayPal account <merchant ID>."; the "PayPal" detail row shows the merchant ID; the checklist step "Connect PayPal" is done.
  - `walk-crew` is already connected to the PayPal seller (merchant `SELLER3MERCHANTID`).
- **Edge cases:** leaving PayPal before the end shows "Connection in progress" with "Continue PayPal setup" and "Start over"; an account PayPal has not cleared shows "PayPal needs attention" with the reason; the card is hidden for team admins who are not workspace owners or admins.

### ACC-13: An admin sets the team's currency, rates and quoting mode

- **Actor:** team admin · **Surface:** web (`{dash}/<slug>/settings`) · **Delivered by:** S1 (`6e79775`) · **Status:** Built
- **Preconditions:** a team seller, signed in as an admin.
- **Steps:**
  1. Open **Settings** ("Team settings").
  2. Change "Team cut (%)" to `12.5`, keep "Management fee (%)" at 10, pick a currency and a "Quoting" mode, then **Save settings**.
  3. Reload the page.
- **Expected:**
  - "Settings saved." appears, and the values are kept after the reload.
  - "Quoting" offers "Open quotes", "Assigned quotes" and "Team quotes"; a "Payout rules" link sits below.
  - The checklist step "Set your rates" is done.
  - New projects take the new rates; existing projects keep theirs.
- **Edge cases:** an empty rate shows "Enter a percent, like 20 or 2.5." and `150` or `2.555` shows "Use a number from 0 to 100, with at most two decimals."; Save stays disabled until both rates are valid.

### ACC-14: A solo seller's settings, and the switch to a team

- **Actor:** solo seller · **Surface:** web (`{dash}/<slug>/settings`, `/members`) · **Delivered by:** R3a (`444c1f4`); solo wording in R3b (`29b6188`) · **Status:** Built
- **Preconditions:** a solo seller (ACC-08).
- **Steps:**
  1. Open **Settings**.
  2. Open `{dash}/<slug>/members`.
  3. Back in Settings, click **Switch to a team**.
- **Expected:**
  - The page is titled "Settings" and shows the bio, the currency and "You work alone, so you keep the whole price. Switch to a team to set a team cut, a management fee and payouts." No rate or quoting fields.
  - The members page shows "You work alone" and "A solo seller has no members and no payouts. Switch to a team in Settings to add people."
  - The switch section says "Your team cut becomes 15% and your management fee 10%. You can add members afterwards."
  - After the switch: the page title becomes "Team settings" with the rates at 15 and 10, Members and Payouts return to the nav, and the checklist shows "Set your rates" and "Turn on automatic payouts" to do.
- **Edge cases:** the switch is one way; there is no control to go back to solo.

### ACC-15: An admin adds members, sets roles and titles

- **Actor:** team admin · **Surface:** web (`{dash}/walk-crew/members`) · **Delivered by:** S1 (`6e79775`); titles in R3a (`444c1f4`) · **Status:** Built
- **Preconditions:** signed in as the Team admin; a second account that has signed up (ACC-04) and is not on `walk-crew` yet.
- **Steps:**
  1. Open **Members**.
  2. Under "Add a member", enter the second account's email, pick **Freelancer**, then **Add member**.
  3. Type a title (for example "Brand designer") in the new row and click outside the field. Reload.
  4. Change the new member's role to **Manager**.
- **Expected:**
  - Walk Through is listed with "Admin · workspace" and no role or title control.
  - The new member appears with the role select; the title survives the reload.
  - The role change is kept after a reload.
- **Edge cases:** an email without an account shows "No Payleor account uses this email. Ask them to sign up first."; adding someone already on the team shows "This user is already on the team."; adding a workspace owner or admin shows "Workspace owners and admins are already team admins." Members cannot be removed in the app.

### ACC-16: Managers and freelancers cannot change the team

- **Actor:** freelancer, manager, outsider · **Surface:** web (`{dash}/walk-crew/*`) · **Delivered by:** S1 (`6e79775`), R3a (`444c1f4`), R3b (`29b6188`) · **Status:** Built (not walked through; covered by router tests)
- **Preconditions:** a `walk-crew` member with the freelancer role and one with the manager role (ACC-15); an account outside the team.
- **Steps:**
  1. As the freelancer, open the dashboard, **Settings**, **Members** and **Services**.
  2. As the manager, open **Members** and the dashboard's Seller page card.
  3. As the outsider, open `{dash}/walk-crew`.
- **Expected:**
  - Freelancer: Settings shows "Only an admin can change the team settings." with Save disabled; Members shows "Only managers and admins can see the member list."; Services has no "Add service" button; "Turn on the store" is disabled with "Only an admin can turn on the store."
  - Manager: sees the member list without add, role or title controls; the Seller page card says "An admin publishes the page."
  - Outsider: "Team not found" and "This address is not one of your stores or services teams."
- **Edge cases:** none.
