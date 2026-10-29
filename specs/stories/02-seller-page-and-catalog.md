# Seller page and catalog (CAT)

The services catalog (departments and services), the bio, publishing, the public seller page, the admin preview, and the seller's policy pages. The seller page's Store section (digital products) is covered in `06-store.md`. Hosts, accounts and the story format are in [`README.md`](README.md).

### CAT-01: An admin adds a service to the catalog

- **Actor:** team admin · **Surface:** web (`{dash}/<slug>/services`) · **Delivered by:** R3a (`444c1f4`) · **Status:** Built
- **Preconditions:** a seller where the user is an admin (ACC-08 or ACC-09).
- **Steps:**
  1. Open **Services**. With no services the page shows "No services yet".
  2. Add a department "Brand" with **Add department**.
  3. Click **Add service**. Fill "Name" ("Logo design"), "Description", "Department" (Brand), "Usually costs" From 150 To 400, "Usually takes" From 2 To 5, and two questions with **Add question**. Click **Create service**.
  4. Add a second service "Business cards", From 60 To 60, 1 to 2 days, no department.
- **Expected:**
  - The new-service form shows no error before the first edit; the hints read "In USD. A fixed price is the same number twice.", "Whole days, from 1 to 365." and "Up to 5. They appear on the request form on your seller page."
  - The list groups "Logo design" under "Brand" with "$150.00 – $400.00 · 2–5 days · 2 questions", and "Business cards" under "Not in a department" with "$60.00 · 1–2 days".
  - The Brand row shows "1 service".
  - The dashboard checklist step "Add a service or a product" is done.
- **Edge cases:** **Add question** is disabled at 5 questions.

### CAT-02: The service form refuses bad input

- **Actor:** team admin · **Surface:** web (`{dash}/<slug>/services/new`) · **Delivered by:** R3a (`444c1f4`); form waits for input since R3b (`29b6188`) · **Status:** Built
- **Preconditions:** the catalog from CAT-01.
- **Steps:**
  1. In a new service, type a price From of `abc`.
  2. Enter From 400 and To 150.
  3. Fix the prices; enter days From 5 To 2.
  4. Fix the days; name the service "logo design" and click **Create service**.
- **Expected:**
  - Step 1: "Enter both prices as amounts, for example 150 or 19.99."
  - Step 2: "The top of the range cannot be below its bottom."
  - Step 3: "The longest time cannot be shorter than the shortest."
  - Step 4: "Your team already has a service with this name." (names are compared without case).
  - **Create service** stays disabled while a problem shows.
- **Edge cases:** decimal or zero days show "Usual days are whole numbers from 1 to 365."; an empty question shows "Every question needs text, up to 200 characters."; an empty name shows "Give the service a name."

### CAT-03: An admin hides, edits and deletes services

- **Actor:** team admin · **Surface:** web (`{dash}/<slug>/services`) · **Delivered by:** R3a (`444c1f4`) · **Status:** Built
- **Preconditions:** the catalog from CAT-01.
- **Steps:**
  1. Click **Hide** on "Business cards".
  2. Open **Projects** > **New project** and open the "Service" list.
  3. Back on Services, open "Logo design", untick "Show this service on your seller page", change the price, then **Save changes**.
  4. Click **Delete** on a service and confirm.
- **Expected:**
  - A hidden service shows the word "Hidden" in grey next to its name and a **Show** button; it is missing from the New project list and from the seller page and preview.
  - The edit is saved and the service now reads Hidden.
  - The delete dialog reads "Delete this service? Projects that used it keep their records."; the service leaves the list.
- **Edge cases:** an unknown service id in the URL shows "Service not found" and "This service is not in your team."

### CAT-04: An admin renames and deletes departments

- **Actor:** team admin · **Surface:** web (`{dash}/<slug>/services`) · **Delivered by:** R3a (`444c1f4`) · **Status:** Built (rename and delete not walked through)
- **Preconditions:** the catalog from CAT-01.
- **Steps:**
  1. Add a department named "brand".
  2. Rename "Brand" to "Branding" in its field and click outside.
  3. Delete "Branding" and confirm.
- **Expected:**
  - Step 1: "Your team already has a department with this name."
  - Step 2: the new name is kept after a reload.
  - Step 3: the dialog reads "Delete this department? Its services stay, ungrouped."; its services move to "Not in a department".
- **Edge cases:** an empty name shows "Give the department a name."

### CAT-05: An admin writes the seller's bio

- **Actor:** team admin, solo seller · **Surface:** web (`{dash}/<slug>/settings`) · **Delivered by:** R3a (`444c1f4`) · **Status:** Built
- **Preconditions:** a seller where the user is an admin.
- **Steps:**
  1. In **Settings**, type 300 characters in "About you".
  2. Replace it with a short bio with spaces at both ends, then **Save bio**.
- **Expected:**
  - The counter reads "300/280" and **Save bio** is disabled.
  - After saving: "Saved.", and the bio is stored trimmed. It appears under the name on the seller page and in the preview.
- **Edge cases:** saving the bio does not mark "Set your rates" done.

### CAT-06: Publishing waits for PayPal and a service

- **Actor:** team admin · **Surface:** web (dashboard "Seller page" card) · **Delivered by:** R3b (`29b6188`); "or product" from R4a (`2df314e`) · **Status:** Built
- **Preconditions:** a draft seller without PayPal (ACC-08), and a draft seller with PayPal but no active service.
- **Steps:**
  1. On each dashboard, read the "Seller page" card.
- **Expected:**
  - The card reads "Draft: only your team can see it." with **Preview** and a disabled **Publish**.
  - Without PayPal: "Connect PayPal before you publish."
  - With PayPal and no active service or product on sale: "Add at least one active service or product before you publish."
  - The checklist shows "Publish your seller page" to do.
- **Edge cases:** a suspended seller shows "This seller is suspended. Contact support@veetlyn.com." (there is no way to suspend from the app).

### CAT-07: An admin publishes the seller page

- **Actor:** team admin · **Surface:** web (dashboard, `{seller}`) · **Delivered by:** R3b (`29b6188`) · **Status:** Built
- **Preconditions:** `walk-crew` with PayPal connected and at least one active service, in draft (unpublish it first with CAT-10 if it is live).
- **Steps:**
  1. On `{dash}/walk-crew`, click **Publish**.
  2. Open the public address from the card.
- **Expected:**
  - The card reads "Live at https://walk-crew.veetlyn.app" (`{seller}` for `walk-crew`) with **Unpublish**.
  - The checklist step "Publish your seller page" is done.
  - The public page answers at once (CAT-08).
- **Edge cases:** only admins see **Publish**; others see "An admin publishes the page." (ACC-16).

### CAT-08: A visitor reads a published seller page

- **Actor:** visitor · **Surface:** web (`{seller}` for `walk-crew`) · **Delivered by:** R3b (`29b6188`); request links from R3c (`8d51ff2`) · **Status:** Built
- **Preconditions:** `walk-crew` published with services in a department and one without (CAT-07).
- **Steps:**
  1. Open `{seller}` for `walk-crew`, not signed in.
  2. Hover the "Request a quote" buttons and the footer links.
- **Expected:**
  - The team's name and bio, then "Services": department headings with their services, then services without a department.
  - Each service card shows its name, description, "Usually <price or range> · <days>" and a "Request a quote" button linking to `/request?offering=<id>`.
  - Below the services: "Looking for something else? Request a quote", linking to `/request`.
  - Hidden services do not appear.
  - The footer has "Terms of service" and "Privacy policy" (relative `/policies/…`), and "Powered by Veetlyn", "Veetlyn terms", "Veetlyn privacy" and "Acceptable use" as absolute links to `{site}`.
- **Edge cases:** a seller with no services and no products shows "No services listed right now."

### CAT-09: Draft sellers are hidden; members preview them

- **Actor:** visitor, team admin · **Surface:** web (`{seller}`, `{dash}/<slug>/preview`) · **Delivered by:** R3b (`29b6188`) · **Status:** Built
- **Preconditions:** a draft seller with a service (for example one from ACC-08 after CAT-01).
- **Steps:**
  1. Open its public address (`{seller}` for its slug).
  2. As an admin, click **Preview** on its dashboard.
  3. Click **Preview** on the published `walk-crew` dashboard.
- **Expected:**
  - Step 1: a not-found page (HTTP 404).
  - Step 2: a bar reads "Preview. This page is a draft; only your team can see it." with "Back to the dashboard", above the page as visitors would see it (bio, services by department, hidden services left out).
  - Step 3: "Preview. This page is live at https://walk-crew.veetlyn.app."
- **Edge cases:** any team member, not only admins, can open the preview; an outsider gets "Team not found".

### CAT-10: An admin unpublishes the seller page

- **Actor:** team admin · **Surface:** web (dashboard, `{seller}`) · **Delivered by:** R3b (`29b6188`) · **Status:** Built
- **Preconditions:** a published seller (CAT-07).
- **Steps:**
  1. Click **Unpublish** and confirm.
  2. Reload the public address.
  3. Publish again (CAT-07) so later stories can use it.
- **Expected:**
  - The dialog reads "Unpublish? Visitors will see a not-found page until you publish again."
  - The card returns to "Draft: only your team can see it."
  - The public address answers 404 on the next request, without waiting for a cache to expire.
- **Edge cases:** none.

### CAT-11: The seller's policy pages

- **Actor:** visitor · **Surface:** web (`{seller}/policies/*`) · **Delivered by:** R3b (`29b6188`) · **Status:** Built
- **Preconditions:** `walk-crew` published.
- **Steps:**
  1. Click "Terms of service" and "Privacy policy" in the seller page footer.
  2. Open `/policies/returns` and `/policies/shipping` on the same host.
- **Expected:**
  - "Terms of service" names the team as the provider and says Veetlyn "is not a party to your agreement with Walk Crew"; it covers quotes, payment (deposit, then balance through PayPal), delivery and contact.
  - Both pages show "Walk Crew" under the title, "Last updated <the team's creation date>", the team's support email as contact, and "This text is a template and is not legal advice."
  - `/policies/returns` and `/policies/shipping` answer 404 for a services seller.
- **Edge cases:** the policies of a draft seller answer 404 like the page.
