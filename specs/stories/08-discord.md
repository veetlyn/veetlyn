# Discord (DIS)

What S2 built: Discord sign-in, linking Discord to a Payleor account, linking a team's Discord server with a one-time code, `/payleor link`, `/payouts setup`, and the interactions endpoint. None of it has been checked on a real Discord server; run E starts with that check (see AGT-20 in [`09-agentic.md`](09-agentic.md)).

Setup the stories assume (all [human], in the Discord developer portal): the Interactions Endpoint URL points at the api Worker's `POST /discord/interactions`; the OAuth2 redirect `{dash}/api/auth/callback/discord` is registered; the app is installed in a test server with the `bot` and `applications.commands` scopes; the commands are registered with `pnpm -F server discord:register` (global commands can take a few minutes to appear).

### DIS-01: Sign up or log in with Discord

- **Actor:** any person with a Discord account · **Surface:** web (`{dash}/signup`, `{dash}/login`) · **Delivered by:** S2 (`8c53d23`) · **Status:** Built (never checked on a real Discord server)
- **Preconditions:** a Discord account whose email is verified.
- **Steps:**
  1. Open `{dash}/signup` (or `{dash}/login`) and click **Continue with Discord**.
  2. [human] Authorize Payleor on Discord.
- **Expected:**
  - The button shows "Redirecting to Discord…" while it leaves.
  - The person lands signed in on `{dash}/` (the workspace home).
- **Edge cases:** a Discord account whose email equals an existing Payleor user's email but is not linked to that user does not sign in as that user unless Discord reports the email verified (no trusted providers). A failure to start shows "Could not start Discord sign-in." as a toast.

### DIS-02: Link Discord to a Payleor account in Account settings

- **Actor:** team admin (any signed-in user) · **Surface:** web (`{dash}/account`) · **Delivered by:** S2 (`8c53d23`) · **Status:** Built (never checked on a real Discord server)
- **Preconditions:** signed in with email; no Discord account linked.
- **Steps:**
  1. Open `{dash}/account`. The "Discord" section says "Link Discord to use Payleor's commands in your team's server with this Payleor account."
  2. Click **Link Discord**.
  3. [human] Authorize Payleor on Discord.
- **Expected:**
  - Back on `{dash}/account`, the section says "Discord is linked to this account. Payleor's Discord commands work for you."
  - The link works when the Discord email differs from the Payleor email.
- **Edge cases:** a Discord account with an unverified email, or any other failure, returns to `{dash}/account?error=discord` with "Could not link Discord. Check that the email on your Discord account is verified, then try again."

### DIS-03: Admin creates a one-time server link code

- **Actor:** team admin · **Surface:** web (`{dash}/walk-crew/discord`) · **Delivered by:** S2 (`8c53d23`) · **Status:** Built (never checked on a real Discord server)
- **Preconditions:** walk-crew has no linked server. The dashboard checklist shows "Link Discord" not done, linking to this page.
- **Steps:**
  1. Open `{dash}/walk-crew/discord`.
  2. Under "Create a link code", click **Create link code**.
- **Expected:**
  - The page explains: "Create a one-time code, then run /payleor link code:… in your server. You need the Manage Server permission there, and your Discord account must be linked to this Payleor account in Account settings. The code expires 15 minutes after you create it."
  - After the click: "In your server, run:" followed by `/payleor link code:{12-character code}` and "Expires {time} ({timestamp})."; the button becomes **Create a new code**.
- **Edge cases:** a freelancer or manager sees "Only an admin can link the Discord server." (the API refuses with the same text).

### DIS-04: Admin links the team's Discord server with /payleor link

- **Actor:** team admin · **Surface:** Discord (test server), web · **Delivered by:** S2 (`8c53d23`) · **Status:** Built (never checked on a real Discord server)
- **Preconditions:** DIS-02 done for a walk-crew admin; a fresh code from DIS-03; that admin has Manage Server in the test server.
- **Steps:**
  1. [human] In the test server, run `/payleor link code:{code}`.
  2. Reload `{dash}/walk-crew/discord` and the team dashboard.
- **Expected:**
  - Discord shows a loading reply only the admin sees, replaced by "This server is now linked to your Payleor team. The Link Discord step in your team's setup checklist is done."
  - The page shows "Your team is linked", "Server ID: {guild id}" and "Payleor's commands work in that server. One server per team; an admin can link again to change it."
  - The dashboard checklist shows "Link Discord" done.
- **Edge cases:** running the same code again answers "That code is not valid. An admin of your team creates a link code in the team admin on Payleor." (codes are used once and expire after 15 minutes).

### DIS-05: /payleor link refuses callers and servers that do not qualify

- **Actor:** Discord server member · **Surface:** Discord (test server) · **Delivered by:** S2 (`8c53d23`) · **Status:** Built (never checked on a real Discord server)
- **Preconditions:** fresh link codes from DIS-03 for each attempt (the code is used up by any attempt that gets past the permission check).
- **Steps:**
  1. [human] Run `/payleor link code:{code}` as a server member without Manage Server.
  2. [human] Run it with Manage Server from a Discord account not linked to any Payleor account.
  3. [human] Run it from a Discord account linked to a Payleor user who is not an admin of walk-crew.
  4. [human] Run it in a server already linked to another Payleor team.
  5. [human] Run it in a direct message with the app.
- **Expected:** each reply is visible only to the caller and nothing is linked:
  1. "You need the Manage Server permission in this server to link it to Payleor."
  2. "First, link your Discord account to Payleor in Account settings ({dash}/account), then run the command again."
  3. "Your Payleor account is not an admin of that team, so it cannot link the server."
  4. "Another Payleor team is already linked to this server."
  5. "Run this command in the server you want to link to your Payleor team."
- **Edge cases:** a wrong or expired code gives the DIS-04 "That code is not valid…" reply; an unexpected failure gives "Something went wrong. Please run the command again."

### DIS-06: /payouts setup links to the member's Payouts page

- **Actor:** freelancer (anyone in the server) · **Surface:** Discord (test server), web · **Delivered by:** S2 (`8c53d23`) · **Status:** Built (never checked on a real Discord server)
- **Preconditions:** the app is in the test server.
- **Steps:**
  1. [human] Run `/payouts setup`.
  2. Open the link.
- **Expected:**
  - An immediate reply only the caller sees: "Set up your PayPal payout destination on Payleor: {dash}/me/payouts".
  - The link opens the member's Payouts page, where OUT-01 continues.
- **Edge cases:** none.

### DIS-07: The interactions endpoint verifies Discord's signatures

- **Actor:** Discord, tester · **Surface:** api Worker (`POST /discord/interactions`) · **Delivered by:** S2 (`8c53d23`) · **Status:** Built (never checked on a real Discord server)
- **Preconditions:** the api Worker is reachable.
- **Steps:**
  1. Send `POST /discord/interactions` with body `{"type":1}`, `x-signature-ed25519: 00` and `x-signature-timestamp: 1`.
  2. [human] Save the Interactions Endpoint URL in the Discord developer portal.
  3. [human] Run an unregistered or outdated command in the test server.
- **Expected:**
  - Step 1 answers 401 with "invalid request signature".
  - Step 2: the portal saves the URL (the endpoint answers Discord's signed PING with a PONG and its bad-signature probes with 401).
  - Step 3: "Payleor does not know this command. Run /payleor link or /payouts setup."
- **Edge cases:** autocomplete requests get an empty list; buttons, modals and other interaction types get "Payleor cannot handle this interaction yet."
