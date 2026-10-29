# Veetlyn release protocol

Approved for implementation by Mouhamed on 2026-10-29. The controls below describe the target release contract; the implementation/evidence section records what is actually enforced.

## Scope and authority

Feature PRs target dev. dev is staging. Only a release PR promotes dev into main. main is the production source. Mouhamed authorizes production promotion; merging an ordinary feature PR is not production approval. The release PR states the candidate commit, scope, evidence, configuration changes, migration impact, and rollback procedure before approval.

Product branding is Veetlyn. Hosting remains Cloudflare. Production uses payleor.com, dash.payleor.com, api.payleor.com, and seller hosts under payleor.app. Staging keeps its existing separate hosts and database. The Render migration is cancelled; its reserved hostname is only a redirect.

## Verified audit findings

- Release PR #27 merged into main as 9a66c501c70e46d476a5c7f78e91488d5069ca65. Its main CI passed, but the associated production deploy failed before running steps. Deploy run 40860687290 reports: Branch "dev" is not allowed to deploy to production due to environment protection rules. A workflow_run event runs the deploy workflow on the default branch, dev; checking out a main commit later cannot change the protected environment's branch context.
- Production environment allows main and has no reviewer approval rule in the inspected configuration.
- Classic main branch protection returns 404. Active ruleset protect-default-branch targets ~DEFAULT_BRANCH, currently dev. It requires PRs and signatures, but lists no required CI checks. It does not establish the requested owner-only protection of main.
- CI runs secret scanning, critical production dependency audit, types, lint, and tests. It does not build the web and API release outputs.
- Manual deployment currently checks the branch/stage pairing but does not require successful CI for the deployed commit.
- Deployment applies database migrations before Alchemy and has no automated post-deployment acceptance gate or release provenance record.
- The saved main-protection.json requests linear history, while the current release method uses merge commits. This must be reconciled before applying the policy.

These findings supersede any earlier implication that merging #27 confirmed it live.

## Recommended deployment model

Keep automatic staging deployment after successful dev push CI. Use a deliberate production workflow dispatch from main, after release PR approval and merge. Validate the exact main merge commit's CI, release evidence, and expected stage before exposing production credentials or applying migrations. This removes the workflow_run/default-branch ambiguity for production.

An alternative is automatic main deployment from a trusted main push workflow with CI and deploy jobs in the same workflow. That is simpler operationally but gives less separation between merge and release. A tag-triggered production pipeline offers stronger version-oriented promotion but adds tooling and ref-policy work. Start with deliberate main deployment and immutable release tags; do not introduce release branches yet.

## Lifecycle and gates

1. Candidate: record the exact dev SHA, scoped changes, migrations, flags, and user-visible effects in a release PR to main. Freeze the candidate for walkthrough evidence; changes require new checks and refreshed affected walkthroughs.
2. Staging verified: successful CI and deployment for that SHA, build validation, and recorded walkthrough evidence. Seeded demos are marked as demos. Scripted agent behaviour is never evidence of a real model/tool integration.
3. Approved: Mouhamed approves the concrete release scope, evidence and rollback plan. A failed or missing required check blocks approval. Approval is tied to the candidate, not a moving branch name.
4. Promoted: merge the release PR. Run CI on the resulting main merge SHA. A merge commit is a different SHA from the staging candidate; check that its tree contains only approved changes. If its tree differs from the verified candidate, stage and verify that exact release tree before production.
5. Deploying: dispatch the production workflow on main. Before mutation, verify its captured SHA equals the approved release SHA and still equals main HEAD, CI succeeded for that SHA, and staging evidence applies to its tree. Acquire one production deployment lock; re-check after acquiring it. Reject stale queued deploys. No moving checkout refs. No separate local production deployment unless explicitly authorized as an emergency.
6. Verifying: inspect both Worker deployments, service bindings, migration outcome, deployed revision/config identity and production smoke tests. Partial web/API deployment is a failed release until repaired or rolled back.
7. Released: only after the production checks pass, create the immutable version tag and release record with the exact SHA, CI/deploy links, environment, timestamp, operator, Worker version IDs, schema migration IDs, configuration fingerprint, verification results and previous known-good release. Never record secret values.
8. Failed or rolled back: record the failure and recovery evidence. Do not call the release shipped or publish its milestones as live.

## Required checks

CI: frozen-lockfile installation, secret scan, dependency audit under the documented severity policy, types, lint, database-backed tests, and production builds of the web and API outputs. Any exception identifies the issue, impact, owner and expiry; it is not silently ignored.

Staging: real flows relevant to the change, route/tenant separation, authorization, session isolation, error paths and mobile usability where affected. Payments use sandbox data. Smoke tests must assert expected responses and page content, not merely HTTP 200. Maintain a release checklist mapping each claim to evidence.

Production while waitlist-only: PLATFORM_NAME remains Veetlyn; domains remain payleor.com/payleor.app; PUBLIC_ACCESS is waitlist on both Workers; landing and waitlist work; login/signup and alternate auth endpoints remain blocked as designed; dashboard access redirects; no sandbox banner or demo credentials appear; seller routing remains isolated; the new logo/favicon and static assets serve correctly. Test waitlist submission only using a designated controlled address and explicit consent, with cleanup recorded. Do not email the list as a deployment side effect.

Backend verification: API readiness and database connectivity; expected migration state; web-to-API binding; queue consumer and maintenance configuration; webhook authentication and environment unchanged. Never make a real charge, payout or refund as a smoke test. Prefer safe observability/readiness probes and sandbox integration evidence.

Observe logs and errors after deployment for an initial ten-minute window, covering one maintenance interval. Record any longer observation needed for change-specific risks. A lack of traffic is not proof of health.

## Configuration and access

Opening production access is its own approved release. A code merge must not implicitly change PUBLIC_ACCESS, PayPal sandbox/live selection, domains or OAuth origins. Compare redacted configuration fingerprints as part of release review. Missing critical flags fail closed before migration/deploy.

Protect dev and main explicitly. Require actual named CI checks, prevent force pushes and deletion, and restrict main promotion according to the owner's requested policy. Match the permitted merge method to release history; allow merge commits if release PRs use them. Configure production to accept only main, with reviewer controls if supported. Verify each rule by API after applying it. A saved JSON file or an unsupported GitHub-plan feature is not an enforced control; record limitations and compensating controls plainly.

Scope production credentials to the production job/environment. Do not execute untrusted PR code with deployment secrets. Treat deploy workflow provenance, repository identity, triggering event, branch and SHA as separate checks.

## Migrations and rollback

Use additive, backward-compatible migrations first: expand, deploy compatible code, backfill separately, then remove old schema in a later release. Assess migration locks and execution time in staging. Confirm a recent recoverable database backup or recovery point before production migrations and record its identity without credentials.

Before deploying, identify how to restore the prior compatible web/API Worker versions and their bindings using the current Alchemy/Cloudflare-supported procedure. Rehearse the procedure in staging; do not assume individual Worker rollback is enough for a coupled release.

Code rollback does not undo database writes, schema changes, sent messages or PayPal operations. Never automatically restore the database or replay payments/webhooks. Preserve webhook idempotency, queues and audit logs. Prefer a forward fix for already-applied migrations. Destructive recovery needs a separate explicit data-loss decision.

Stop promotion on failed checks, incorrect access flags, incorrect domain or payment environment, session/tenant leakage, broken waitlist or partial deployment. During an incident, pause further releases, record observed state, choose compatible rollback or forward repair, verify recovery, and document the cause before resuming.

## Hotfixes

Branch from the deployed main SHA. Keep the fix minimal, run required checks, verify on staging, obtain the owner's release approval, merge through a PR, deploy and verify through the same production gate, then reconcile the hotfix into dev. An emergency can shorten the walkthrough scope; it cannot silently bypass identity, secrets, payment-safety or deployment verification.

## Immediate next work

1. Repair production workflow provenance and add exact-SHA CI validation, including manual dispatch.
2. Align and enforce branch/environment controls where the account supports them.
3. Add release builds, revision/config reporting, smoke tests and release records.
4. Rehearse migration recovery and coupled Worker rollback in staging.
5. Re-release the already-approved logo change through the corrected protocol, then verify the production result.

No implementation or live configuration change is included in this proposal.


## Implementation and operator evidence

2026-10-29: main protection was successfully applied and read back through the GitHub API after the repository became public. It requires PRs and the GitHub Actions check, applies to administrators, restricts main promotion to Mouhamed-B, disables deletion/force pushes and permits merge commits. The active dev ruleset now names the required check and dismisses stale reviews. The production environment permits main only and requires review by Mouhamed-B; administrator bypass is disabled. Version tags matching v* reject update/deletion without bypass actors. Earlier plan-limit statements in the audit are historical, not the current enforcement status.

The Deploy workflow separates automatic staging from manual production. The executable gate validates branch freshness, exact-SHA push CI, release-owner identity, immutable version and same-tree staging artifact provenance. Production configuration is compared to .github/release-policy.json before migration. A public /.well-known/release descriptor on each Worker reports only approved public fields, the commit and the Worker version ID. The smoke verifier compares both live Workers, checks API/database readiness and host/access boundaries, and matches the favicon bytes to the release tree. Verified artifacts record Worker IDs, configuration fingerprint, migration file hashes, operator, CI/deploy linkage and the prior release.

The production dispatcher must supply a real repository issue/PR URL recording the walkthrough, backup/recovery point, prior compatible Worker versions, rollback rehearsal and intended version. The gate requires the evidence issue/PR to be authored by the release owner and contain `Version: vX.Y.Z`, `Release tree: <tree SHA>`, `Walkthrough: passed`, `Recovery: verified`, and `Previous release: <baseline>`, as well as the actual supporting details. It validates that record and staging automation evidence; it cannot prove that a human walkthrough or recovery rehearsal occurred. The dispatch by Mouhamed-B attests to those facts. Never manufacture that evidence or substitute a blank issue. A release missing that operational evidence is not ready for production.

Operator invocation (after the release PR is merged and main push CI passes):

```sh
gh workflow run deploy.yml --repo veetlyn/veetlyn --ref main \
  -f stage=production -f sha=FULL_APPROVED_MAIN_SHA \
  -f staging_run=VERIFIED_STAGING_DEPLOY_RUN_ID \
  -f version=vX.Y.Z -f recovery_url=REPOSITORY_EVIDENCE_URL
```

For staging, use the dev push-triggered deployment or manually dispatch from dev with stage=staging and the exact current dev SHA. A branch advancing invalidates a queued candidate. An expired artifact requires a new successful staging deployment. Do not delete/move a published release tag to retry a release; record the failure and use a new version.

Cloudflare changes are not atomic across the web Worker, API Worker and database. Smoke verification is an acceptance gate, not an automatic rollback. If it fails, the workflow fails without publishing a release; inspect deployment state and perform the documented compatible recovery. Production cannot be declared released until verification and the ten-minute observation/recovery checklist are complete. The production job repeats the probes once per minute for ten minutes and records the observation interval before publishing. Human log and queue review remains part of the operational evidence.

A rebuild uses the pinned lockfile and same compiler but is not byte-identical artifact promotion across stages. Stage-specific bindings differ. Same-tree staging evidence, CI build validation, and live revision/configuration probes are the enforced guarantees.
