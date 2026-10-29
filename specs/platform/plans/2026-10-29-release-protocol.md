# Release protocol implementation plan

Approved by Mouhamed on 2026-10-29. Execute in this session using the executing-plans workflow.

Goal: a production release requires the approved immutable commit, passing push CI, verified staging evidence for its tree, safe configuration and successful production probes.

Architecture: staging retains CI-triggered deployment from dev; production uses explicit dispatch on main. A dependency-free Node gate verifies GitHub evidence before a protected deployment job. Both Workers expose a public, non-secret revision descriptor. Smoke probes compare descriptors and test waitlist restrictions. Deployment records are persisted as workflow artifacts; successful production creates an immutable release tag and GitHub release.

- [x] Add release-gate tests at the executable boundary for failed/missing CI, stale commits, invalid branch/event/actor, invalid staging evidence, and invalid release versions. Demonstrate failure before implementation.
- [x] Implement scripts/release-gate.mjs, with read-only GitHub evidence retrieval and fail-closed checks. Serialize deployment by stage and revalidate branch freshness before mutations.
- [x] Update Deploy workflow: staging automatic only; production manual only from main; require SHA, staging run and version; validate before protected job and again before migrations. Add release record artifact and production tag/release only after verification.
- [x] Add revision/config descriptors to both Workers, and side-effect-free smoke probes for matching revision, waitlist restrictions and new logo assets. Add release builds to CI.
- [x] Document operator checklist, migration/backup and rollback gates, build evidence, permissions and actual enforcement limitations. Align main-protection merge-history policy.
- [x] Run gate regression tests, existing affected tests, lint, types and builds; review final diff.
- [x] Verify/apply supported branch/environment protections. Do not silently relax a failing protection to get a release through.
- [ ] PR to dev, stage and verify, release PR to main, explicit production dispatch only after evidence and CI pass. Declare completion only with live probes and a release record.

Manual walkthrough/backup/rollback attestations remain explicit operator evidence, never inferred from automated tests. A missing recovery rehearsal blocks production; it must not be manufactured by the implementation.

Review: a read-only second-agent review found candidate self-admission, lazy database readiness and prior-CI-success masking. All three were corrected before the PR: trusted pre-checkout validation, an actual select 1 query, and latest matching push-CI selection.

Local evidence: 25 policy/config cases; 26 affected regression cases across four files; web/server/infra type checks; repository lint; actionlint; web build through the Alchemy Cloudflare compiler; API build. Full database-backed CI remains the merge gate. No production deployment or successful rollback rehearsal is claimed.
