# payleor.com, rebuilt on the Landing B design system, then the dash

**Date:** 2026-10-19. **Status:** proposed; the content and look were approved on the prototype by Mouhamed during the 2026-10-19 session ("I love this ds. Plan the full integration to payleor.com with all the features. Then we need the dash to follow."). **Prototype:** [`2026-10-19-landing-b.html`](2026-10-19-landing-b.html) and its folder [`2026-10-19-landing-b/`](2026-10-19-landing-b/) (published as a private artifact; the build script and sources live in the session scratchpad and are reproduced by the plan).

## 1. Intent

payleor.com becomes the prototype: a site that tells the stories of agentic commerce for anyone who sells, is honest about what exists, and makes search and AI visibility Payleor's strongest weapon, for its own pages and for every seller's. The dash then takes the same design system so the product and its site look like one thing.

## 2. Decisions taken during the session (Mouhamed, 2026-10-19)

- **Positioning:** "Sell where AI shops." Agentic commerce with a person on every payment: their agents find, ask, request and fill carts and never pay; your agents draft, answer and pay by your rules; Payleor holds the money rules, and PayPal moves the money. Payleor is in front of every integration, with its own terms on top of each (Claude and ChatGPT, PayPal checkout, PayPal Payouts, Discord, the API, every offer).
- **Audiences:** Freelancers, Agencies, Stores, Studios (businesses that sell services and products, such as salons and pottery studios). Stores is the word Shopify and WooCommerce owners use.
- **Payleor Network** is the name of the client's AI connector (the plugin), with its own page. Never write "listed in Claude and ChatGPT": only clients who add the connector find sellers through it until directory listings are approved.
- **Membership** is Payleor Network's "blue check": a waitlist with manual approval, earned with a verified PayPal business account, a delivery record and online proof (Trustpilot, Google Business Profile, social accounts). Members get AI visibility. Teased now, gatekeeping later.
- **Visibility:** web SEO is included in every plan; AI visibility comes with membership and covers FirstIndex's scope (mention tracking, research, question map, articles and comparison pages, page fixes, index checks, fact checks, listings, weekly report), run by an agent that drafts and ships nothing without the seller's yes. "We report what happened. We never promise rankings."
- **Discover:** a page that lists the network's offerings for people, like Gumroad's Discover; Discover sales count toward the network fee.
- **Blog:** first teaches Payleor's differences, one article per kind of seller, each with an illustration drawn from the brand's shapes.
- **Pricing page** integrates the 2026-10-19 pricing draft: plans with full feature lists and agents per plan, Enterprise with "Talk to sales", monthly and yearly, a fee calculator, the bundle, the network fee explained, and the getting-found section. Price changes proposed on 2026-10-19 (network fee to 10% once, a paid AI visibility membership, a free store tier) are not decided; the site shows today's numbers from `packages/core`.
- **Navigation:** two mega menus ("Network": Payleor Network, Discover, Get found, Membership; "Who it is for": the four audiences), each a grid of illustrated tiles plus a featured card; Pricing, Blog, Contact; a tiled menu on phones.
- **Logos:** a "Where clients find you" strip (ChatGPT, Claude, Perplexity, Gemini, Google; "Paid through PayPal") in monochrome. Marks come from Simple Icons where they are published; ChatGPT gets a neutral chat glyph; no customer logos until real sellers agree.

## 3. Claims the site may make

The page is written for the Nov 12 submission and the sandbox. The rules:

- Everything in the Oct 31 runs (C, B, M, E, D, P and the optional AI seller) is described as working. If a run is cut, its lines come out before deploy (the plan lists them).
- Run V (web SEO on seller pages, Discover live) is proposed without a slot: until it ships, Discover shows sample listings labelled as samples, and web SEO on seller pages is described as part of every plan only once V is merged. Until then the Get found page and the pricing page say "built into every page" only for payleor.com itself and mark seller-page SEO "Coming with run V" (the plan's copy table has the exact words).
- Membership and AI visibility are marked Planned and Waitlist.
- No invented proof: no reviews, ratings counts or business numbers in search or report mock-ups; examples are labelled.
- Payments: "The payer approves every payment in PayPal; a person or a rule you set approves every payout." Payleor never holds money.
- Competitor numbers (Gumroad 10% + $0.50 direct and 30% on Discover, checked 2026-10-19; Fiverr 20%) are rechecked on the day the page deploys.

## 4. Architecture

- **Where:** `apps/web/src/app/(site)/` (the `www` host passes through, `apps/web/src/lib/host-routing.ts:26`). New routes: `/network`, `/discover`, `/visibility`, `/freelancers`, `/agencies`, `/stores`, `/studios`, `/contact`, `/blog`, `/blog/[slug]`; `/` and `/pricing` are rewritten. None collides with the internal trees (`dash`, `admin`, `store`, `host-routing.ts:15`).
- **Design system:** the prototype's palette already matches Relief (`packages/ui/src/styles/globals.css:22-77`): ground is `--background`, surface `--card`, sunk `--tray`, ink `--foreground`, muted `--muted-foreground`, mint `--brand`. The new tokens are the dark band (`--band`, `--band-ink`, `--band-muted`, `--band-raise`, `--band-line`) in `packages/ui` so the dash can use them, and the bowl shape stays the `bowl` utility (`apps/web/src/index.css:40`). Cal Sans UI 600 for headings and Inter for text stay as they are (`apps/web/src/app/layout.tsx:8-27`).
- **Numbers:** every price and fee on the site comes from `packages/core` (`SELLER_PLANS`, `PLANS`, `NETWORK_FEE_BPS`, `bundleQuote`, `platformFeeMinor`, `quoteBreakdown`); the calculator and the example splits never hold their own copies.
- **Content:** blog articles are MDX in `apps/web/src/content/blog/` with a typed registry; MDX already works (`apps/web/src/app/(site)/legal/terms/page.tsx`). FAQs, audiences, listings and nav are typed data.
- **SEO and AI visibility for payleor.com:** `generateMetadata`/`metadata` per page (description, canonical, Open Graph), JSON-LD per page type (Organization, WebSite with a SearchAction on Discover, BreadcrumbList, FAQPage, BlogPosting, SoftwareApplication offers, CollectionPage), `app/sitemap.ts`, `app/robots.ts` allowing the AI crawlers, and `app/llms.txt/route.ts`. vinext supports route handlers and metadata routes (its README, "Metadata file routes": sitemap, robots, OG images). Sample Discover listings never appear in structured data.
- **Motion:** the prototype's script becomes small client components (chat demo, pinned story, entrances, mega menus, Discover filters, blog topics, calculator, bundle builder, contact form), each with a reduced-motion path and nothing hidden without script.

## 5. Phases

| Phase | What | Plan | Slot |
|---|---|---|---|
| L | The site on payleor.com: every page, the mega menus, the blog, Discover with samples, the SEO layer | [`plans/2026-10-19-l-site.md`](plans/2026-10-19-l-site.md) | Proposed: in parallel with C (Oct 20–23), it touches only `(site)` routes, `packages/ui` tokens and `apps/web/src/lib/site` |
| V | Web SEO on every seller page; Discover over the network's search; Discover sales count toward the network fee | to write after C (it reuses C's offering search) | Needs a slot (program §4) |
| W | Membership waitlist: a form that stores applications with their proofs, an admin list to approve or decline, the member check on cards | to write | After the hackathon unless a slot opens |
| AV | AI visibility agent for members | to design | After the hackathon |
| DS | The dash follows: shell, navigation and surfaces on the band, tiles and illustrations, through `design-system-boss` (`playbooks/migrate.md`), screen by screen with `ui-review` | to write, starting with an audit | After L merges; must not break any story walkthrough before the Oct 31 freeze |

## 6. The dash, in outline

The dash keeps its information architecture and Relief components; it takes the site's band for its top bar, the illustrated tile for empty states and navigation menus (the workspace switcher and the team menu become mega-menu panels), Cal Sans headings, mint as the only signal, and the bowl for primary buttons and markers. `design-system-boss` runs `migrate.md` in audit mode first, cites `migrate-design-system`'s lessons, and the migration only starts once the audit is approved. The screens most likely to show in the demo go first: workspace home, project page, payouts, pay page, client page.

## 7. Open for Mouhamed

1. Slots for L (proposed in parallel with C) and V.
2. Price changes (network fee, paid AI visibility, free store tier).
3. Whether the old landing components stay for comparison behind a flag or are deleted when L merges (the plan deletes them).
