**Cloudflare’s last two weeks (roughly Sept 18–Oct 2, 2026) were dominated by Birthday Week announcements** (tied to their Sept 27, 2010 launch anniversary). The volume was high, with a clear focus on **AI agents**, open-source tooling, developer experience, edge infrastructure upgrades, and security/post-quantum readiness. Primary sources: @Cloudflare, @CloudflareDev, and @CFchangelog.

### Major Open-Source Releases
- **Clef & Clef-flash** (Oct 1): Open-source decision models hosted on Workers AI. Designed for high-speed classification and agentic workflows. Fully compatible with prior “Jev” API; positioned as smarter/faster alternatives.
- **EmDash 1.0** (Sept 28): Stable open-source CMS built for Astro. Features agent-friendly workflows, secure sandboxed plugins, and a decentralized registry that keeps publishers in control.
- **Forge** (Sept 28): Pluggable open-source pipeline that runs in CI to generate SDKs, CLIs, and documentation directly from API definitions. Shifts generation upstream into team repositories so tools stay continuously in sync. Released alongside the new `cf` CLI.
- **`cf` CLI** (Sept 28): New command-line tool that mirrors the entire Cloudflare API and supports programmatic TypeScript configuration. Major developer experience upgrade.

### AI Agents & Developer Platform
- **Artifacts** (open beta, Oct 1): Git platform built for the AI-agent era. Create/fork repos from a Worker, hand out tokens, clone with any git client, with events on every push. Includes Workers bindings, data jurisdiction controls, and event subscriptions. Cloudflare is running a competition (“build the next GitHub”) with prizes (top teams to Connect 2026 + $25k credits). Available on Workers Paid plan.
- **Cloudflare Containers upgrades** (Sept 30 + changelog): 6x faster starts; agents can choose image + instance type at runtime; filesystem snapshot APIs in public beta; Durable Object scheduling policy in public beta. All controllable from a Durable Object — major win for agent sandboxes.
- **Cloudflare OS** (Oct 1): Agent workspace that knows how your company works and connects to its data/systems. Waitlist opened for fully managed deployments (launchable in a few clicks).
- **AI Search generally available** (Oct 1): Now embeds image pixels for visual search, runs OCR on scanned PDFs, accepts files up to 10 MiB, works with any chat model.
- **Auto Router** (public beta via AI Gateway, Sept 30).
- **Workers post-quantum support** (Oct 1): Opt-in ML-KEM and ML-DSA algorithms.

### Infrastructure & Data
- **Workers KV Instant** (Oct 1): Sub-2 ms p99 read latencies + 250 ms global replication across 300+ edge locations. Eliminates cold-read penalties while keeping the familiar KV API.
- **Cloudflare K2** (Oct 1): Serverless event streaming built on R2. Durable, ordered log streams with producers/consumers decoupled at the edge — no traditional broker-cluster ops.
- **Cloudflare Basin** (GA + rename, Oct 1): Formerly the Cloudflare Data Platform (ingest/store/query analytical data). Now generally available under the new name.
- **Cache invalidation** (instead of purge): Revalidates with origin so only changed assets are downloaded (saves bandwidth).
- **Browser Run concurrent connections** + WebMCP in Kitesurf sessions + Workflows via `ctx.exports` (no binding required).

### Security & Trust
- **Applying to become a Certificate Authority** (Sept 29): 12 years after Universal SSL. ACME-first, established root, Merkle Tree Certificates for post-quantum readiness and compact/auditable authentication. Separate post on MTC details.
- **Threat Signals + expanded Cloudforce One Threat Events Platform** (Sept 29): Now available to every Cloudflare account. Automatically parses open-source threat reporting, extracts structured indicators, and wires context into WAF rules.
- **Turnstile Spin** (Sept 25): Uses your preferred AI coding agent to automatically wire up proper server-side verification (fixes incomplete Turnstile setups).
- **Vary support in Cache Rules** (now on every plan).

### Monetization & Other
- **Monetization Gateway** (closed beta, Sept 30): With four customer use cases already in production.
- **Registrar upgrades** (Sept 30): Faster/transparent search across 420+ extensions (Workers + Durable Objects + WebSockets); expanded API + `cf` CLI support for agents to search/register/transfer domains.
- Client betas (Windows/macOS Cloudflare One), Managed Rulesets in Unified Routing, and various smaller DX/polish items via @CFchangelog.

### High-Level Insight
Birthday Week 2026 was heavily **agent-centric**: Cloudflare is treating AI agents as first-class users of the internet (git platforms, sandboxes, decision models, workspaces, domain management, etc.). They paired this with aggressive open-sourcing (Forge, EmDash, Clef) and continued investment in edge performance (KV Instant, Containers) and long-term trust/security (CA application + post-quantum). The messaging repeatedly emphasizes choice, sovereignty, and keeping the open web sustainable amid rising automated traffic.

Most announcements link to detailed blog posts on blog.cloudflare.com. Activity was concentrated Sept 28–Oct 1.
