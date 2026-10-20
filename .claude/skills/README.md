# Skills

Workflow skills for agents working on this repository (Claude Code loads them from here; Droid has the same set locally). `CLAUDE.md` says when to use each.

| Skill | Use |
|---|---|
| `brainstorming` | Turn an idea into an approved design (designs go in `specs/platform/`) |
| `writing-plans` | Turn a design into a task-by-task plan (`specs/platform/plans/`) |
| `subagent-driven-development`, `executing-plans` | Build a plan task by task with reviews |
| `using-git-worktrees`, `test-driven-development`, `requesting-code-review`, `verification-before-completion`, `finishing-a-development-branch` | The steps those skills call |
| `test-audit` | Gate for every new or changed test, and test sweeps |
| `anti-slop` | Code, prose and design quality checks |
| `design-system-boss` | Leads design system work: reads the app, picks a playbook, runs the skills below in order |
| `build-design-system`, `migrate-design-system`, `token-mapping`, `component-docs`, `ui-review` | Build the system from the shipped UI, move screens onto it, map raw values to tokens, document a component, review a screen |
| `quartz`, `lime` | Rules and source of design.how's two systems; Quartz is the base Payleor's system builds on |
| `securebydesign` | Security checks on every design, API, auth, storage or deploy change |
| `security-audit` | Vulnerability audit with verified, machine-readable findings; run on each run's diff before its merge (`quick` profile, scoped run) |

Origins: the planning, execution and development skills come from the open source Superpowers skill library (MIT licence); `test-audit`, `anti-slop` and `securebydesign` come from Mouhamed's skill set; the design system skills, `quartz` and `lime` come from design.how (`arla6ka/design.how`, MIT licence), copied on 2026-10-17; `security-audit` comes from Cloudflare (`cloudflare/security-audit-skill`, commit `c1c8a8c`, MIT licence in its folder), copied unchanged on 2026-10-20. The rest were copied on 2026-10-13; where a skill names a default path (for example `docs/superpowers/specs`), `CLAUDE.md` overrides it.
