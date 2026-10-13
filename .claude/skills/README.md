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

Origins: the planning, execution and development skills come from the open source Superpowers skill library (MIT licence); `test-audit` and `anti-slop` come from Mouhamed's skill set. Copied on 2026-10-13; where a skill names a default path (for example `docs/superpowers/specs`), `CLAUDE.md` overrides it.
