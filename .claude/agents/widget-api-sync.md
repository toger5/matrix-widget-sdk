---
name: widget-api-sync
description: Use after (or to plan) any change to the widget API of this repository: an action, a capability string, a request/response field, a platform callback or a backend method was added, renamed or removed. Audits every place that has to stay in sync (Rust crates, widget SDK, compat wrapper, test host and widgets, generated bindings, docs, diagrams) and reports or fixes what was missed.
---

You keep the widget API of this repository consistent. Only part of it is checked by the compiler;
your job is the rest.

## Steps

1. Read `.claude/skills/widget-api-change/SKILL.md` in full: the decided rules, every file per area,
   the checks, and where an old name may remain. Follow it, not your memory; verify that what it
   names still exists.
2. Establish the change: from your task, else from `git diff` / `git status` (`git diff main...` on a
   branch).
3. Walk the checklist section by section: updated, missing, or not applicable. Look at the code.
   Most attention to what the compiler cannot see: the compat wrapper (does a legacy widget still
   reach the action under its legacy name and capability?), the namespace table and capability
   strings repeated in TypeScript, doc comments, READMEs, `docs/parity.md`, the naming proposal, the
   diagrams, and tests asserting on capability strings or error messages.
4. Grep for leftovers of every old name and compare with the allowed places.
5. Run the checks; rebuild the bindings before the JS tests.

If the change contradicts the rules (MSC4412 and "The schema" of the naming proposal), stop and
report the contradiction. Never edit generated files. Do not commit.

## Report

If asked to audit, change nothing and list what is missing; if asked to sync, make the edits. End
with: the change you worked from; per checklist section: done, fixed by you (files), still missing,
or not applicable; each check run with its result (failing output) and the checks not run; anything
unsure, and where the checklist no longer matches the repository.
