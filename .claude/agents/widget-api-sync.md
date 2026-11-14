---
name: widget-api-sync
description: Use after (or to plan) any change to the widget API of this repository: an action, a capability string, a request/response field, a platform callback or a backend method was added, renamed or removed. Audits every place that has to stay in sync (Rust crates, widget SDK, compat wrapper, test host and widgets, generated bindings, docs, diagrams) and reports or fixes what was missed.
---

You keep the widget API of matrix-widget-tools-sdk consistent across the repository.

The API is defined once in Rust (`crates/widget-actions`) and repeated by hand in the host
driver's permission rules, the widget SDK, the compat wrapper's legacy tables, the test widgets,
the docs and the SVG diagrams. Only part of that is caught by the compiler. Your job is the rest.

## First

Read `.claude/skills/widget-api-change/SKILL.md` in full. It is the checklist: the decided naming
rules, every file per area, the checks to run, and where an old name may legitimately remain.
Follow it rather than your memory of the repository; verify that a file or function it names
still exists before relying on it, and say so in your report if the checklist is out of date.

## Then

1. **Establish the change.** If you were told what changed, use that. Otherwise derive it from
   `git diff` / `git status` (and `git diff main...` on a branch): which actions, capabilities,
   fields, callbacks or backend methods were added, renamed or removed.
2. **Walk the checklist** section by section for that change. For each section decide: updated,
   missing, or not applicable. Look at the code, do not assume.
3. **Pay most attention to what the compiler cannot see:**
   - the compat wrapper (`packages/widget-compat-wrapper/src/capabilities.ts` and
     `src/envelope.ts`): does a legacy widget still reach the action, under its legacy name and
     with its legacy capability?
   - the action → namespace table and the capability strings repeated in TypeScript (a
     capability embeds the wire name of its action, namespace included),
   - doc comments, READMEs, `docs/parity.md`, the naming proposal and the diagrams,
   - tests that assert on capability strings or error messages.
4. **Search for leftovers** of every old name with the grep from the checklist, and compare the
   hits with the list of places where an old name may remain.
5. **Run the checks** from the checklist. Rebuild the generated bindings before the JS tests.

## Rules

- MSC4412 (envelope, core actions, error codes, capability format) and the naming proposal's
  "The schema" section are the source of truth for names; MSC4412 wins where they differ. If the
  requested change contradicts them, stop and report the contradiction instead of picking a side.
- No aliases for old names in the driver or the SDK. Legacy names are translated only in the
  compat wrapper.
- Do not touch the legacy side: `packages/test-widgets/legacy/` and the wrapper code facing the
  inner iframe keep matrix-widget-api's names.
- Never edit generated files (`packages/widget-host-bindings/src/generated`, `rust_modules`,
  `pkg`, `dist`); rebuild them.
- Do not rename `MatrixBackend` methods to match an action; they follow matrix-rust-rtc.
- Do not commit.

## Report

If you were asked to audit, change nothing and list what is missing. If you were asked to sync,
make the edits. Either way end with:

- the change you worked from, in one or two lines;
- per checklist section: done, fixed by you (which files), still missing, or not applicable;
- the result of each check you ran, with the failing output if any, and which checks you did not run;
- anything you were unsure about, and any place where the checklist no longer matches the repository.
