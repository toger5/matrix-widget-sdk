---
name: widget-host-ui
description: Use to plan, design, implement or review a UI change of the widget host app (packages/widget-host), such as a new or changed view, panel, section, prompt, flow or layout, including the dev tools and the DevBackendView. Works in a fixed order (appDesign.md, appViewModel.ts, the design mockups and leaves, then views with stories, view models and app logic, then Playwright tests) and keeps the design documents, leaves, stories, tests and findings in sync. Can stop after the design for review.
---

You change the UI of the widget host the way this repository does it: the design first, then the
code bottom up, the tests last. All paths are relative to `packages/widget-host/` unless they
start with `.claude/` or `packages/`.

## First

1. Load the `widget-host` skill (`.claude/skills/widget-host/SKILL.md`) and read
   `src/views/README.md`. They are the rules for the code. Check that a file they name still
   exists before relying on it, and report it if one does not.
2. Pick the mode (below) from your task. Without an explicit one, implement.
3. Find what the change touches:
   - the sections of `appDesign.md`;
   - the mockup functions (`grep -n "^export" design/src/components.mjs`) and the leaves
     (`grep -n 'id: "<area>/' design/src/leaves.mjs`);
   - the views in `src/views/<area>/` and their stories (a `// leaf <id>` comment names the leaf);
   - the tests that reach those leaves (`e2e/leaves.md`);
   - the open findings of the area (`implementation_findings.md`, `grep -rn "TODO-FINDING" src e2e`).
4. If the change needs a new or changed action, capability, request/response field, platform
   callback or backend method, that part follows the `widget-api-change` skill. Do not invent
   protocol in the UI.
5. Note `wc -l appDesign.md` and the number of leaves before you start.

## Modes

| mode | does | ends after |
|---|---|---|
| plan | changes nothing; lists per step the files, the leaf ids (new, redrawn, removed) and the tests, and the design questions for the user | the plan |
| design | steps 1 to 3, for tasks that say "design first" | step 3, reporting the leaf ids for review and the tsc errors step 2 left for step 4 |
| implement | steps 1 to 5. If the design was already done and reviewed, check that it matches the task and start at step 4 | step 5 and the checks |
| review | changes nothing; checks a diff (`git diff`, or the commit you were given) against every rule below | a report per step |

## Step 1: `appDesign.md`, what the UI is

- Write the new design into the section of the view it belongs to. Replace what was there. No
  changelog, no history ("now", "no longer", "changed to", "new:"), no dates.
- Use the shortest wording that still decides the design: one bullet per behaviour. No file names,
  intents or CSS outside the "Details" section.
- Delete what the change makes obsolete anywhere in the file: "Features", "Custom behavior",
  "Details", and the bullets of "Required visualisations" for states that no longer exist. Add a
  bullet there for each new state; each becomes a leaf in step 3.
- Compare `wc -l` with the start. Every added line must state a requirement that is not already
  there. Shrink the file where you can (duplicates, prose the mockups show anyway), at least in the
  sections you touched. Report the line count before and after.
- If "Corrections to the design documents" in `implementation_findings.md` names a statement in a
  section you edit, apply the correction there and delete the entry.
- A user decision that settles a finding or a "Still open" point of `designFeedback.md` is written
  here; the finding is deleted in step 4.

## Step 2: `src/appViewModel.ts`, the view structure

Only if the structure changes:

- the interfaces of the changed views (documented fields; `leaves …` comments with the leaf ids);
- `AppIntent` members, each with a trailing comment (what it does; `confirmed?` if a modal
  confirms it); derived functions;
- the tree in the header comment.

Keep the view model serialisable and free of runtime objects. High-frequency data goes into the
data shapes at the bottom (`WidgetDevToolsData`, `MockedRoomData`), read through a `ViewEnv` hook;
view-only state stays in the component. New fields of persisted types (`SettingsViewModel`,
`WorkspaceLayout` and what it contains) are optional or defaulted, and read in `loadPersisted` /
`upgradeWorkspace` (see the skill).

Run `npx tsc --noEmit`. The errors are the work list of step 4; do not fix them here.

## Step 3: `design/`, the mockups are the specification

- `design/src/components.mjs`: one function per view returns its HTML; a new state is an option of
  that function. Atoms (`ibtn`, `btn`, `toggle`, `field`, `json`) are at its top; `icon()`,
  `avatar()` and the fixture data (`ACCOUNTS`, `ROOMS`, `WIDGETS`, `MEMBERS`) are in
  `design/src/lib.mjs`. Roles, `title`s and `aria-label`s are part of the design: the app copies
  them and the tests find elements by them.
- `design/src/leaves.mjs`: one leaf per state of "Required visualisations":
  `{ id: "<area>/<state>", section, group, title, w, h, note?, theme?, html }`, `section` from
  `SECTIONS`. A redrawn state keeps its id; only a new state gets a new id.
- `design/mock.css`: tokens (`var(--…)`) only, both themes.
- Build: `npm run design -w @matrix-widget-tools/widget-host`. It writes `design/leaves/**.html` and
  `design/index.html`; both are committed, never edited by hand. Look at every changed leaf:
  `node e2e/tools/shot.mjs leaf <id> <scratch dir>/<id>.png` (add `light` once) and read the PNG.
- **A removed or renamed leaf.** The build does not delete pages. Run `node e2e/tools/leaves.mjs`:
  it prints the `rm` command for the stale page (use the full absolute path) and every place that
  still names the old id: rows of `e2e/leaves.md`, `host.leaf("…")` calls, `// leaf …` comments of
  stories and views, `appViewModel.ts`, `implementation_findings.md`. Replace the id with the new
  one, or remove the mention. Tests and stories of a removed state are updated in steps 4 and 5.

In design mode, stop here and report.

## Step 4: the app, bottom up

There is no ESLint: `npx tsc --noEmit` is the linter (it checks `src`, `e2e` and `.storybook`;
`test/` is only checked by `npx vitest run`). Let it lead from the view changes to everything that
depends on them.

**4a. Views and stories** (`src/views/<area>/`):

- Follow `src/views/README.md`: markup 1:1 from the mockup function, atoms, accessible names,
  `data-*` attributes, stories (2 to 5 per view, each naming its leaf).
- A design change may change a view's `…Props` contract; then update its parents and stories in
  the same step (tsc lists them).
- CSS: port what you changed in `design/mock.css` to the same rules in `src/styles/app.css`.
  Everything above its comment `/* --- real widgets` is a copy of `mock.css` with deliberate
  differences only: no font `@import`, `[data-theme=…]` instead of `:root[data-theme=…]`,
  `pointer-events: none` on `.dev-badge`.
  `diff -B <(sed '/^\/\* --- real widgets/,$d' src/styles/app.css) design/mock.css` must show
  only those. App-only rules go to the end, as `src/views/README.md` says.
- A new icon: copy its entry from `ICONS` in `design/src/lib.mjs` to `src/views/ui/icons.ts` (there
  is no generator; tsc reports a missing `IconName`).
- Stories: update the stories of redrawn leaves, add one for each new leaf, delete those of
  removed leaves. Shared fixtures go to `src/views/fixtures.ts`.
- Compare every changed story with its leaf. Start Storybook in the background
  (`npm run storybook -w @matrix-widget-tools/widget-host`, port 6006), then
  `node e2e/tools/shot.mjs story <story id> <scratch dir>/story.png <w> <h> [light]` at the leaf's
  size (`w`, `h` in `leaves.mjs`), and read both PNGs. Fix the differences or list them. Stop
  Storybook when you are done.

**4b. View model**: the code that produces the slices the views now get: derived functions in
`appViewModel.ts`, pure transitions in `src/app/layout.ts` (with `test/layout.test.ts`), and the
`handle()` cases in `src/app/controller.ts` that only change the view model.

**4c. App logic**: the effects behind the intents and the data behind the hooks: the controller's
effects, `src/app/runtime/widgetRuntime.ts`, `src/matrix_session/memory/devBackend.ts` and
`seed.ts`, `src/session.ts` and its implementations, `src/app/persistence.ts`,
`src/app/testHook.ts`. The recipes are in the skill ("Where to add …").

Then `npx tsc --noEmit` and `npx vitest run` are green. If the mockup turns out wrong or
incomplete while implementing, go back to step 3 (and 1) rather than diverging silently. A
judgment call that the design does not settle becomes a finding.

## Step 5: Playwright tests (`e2e/`, harness in `e2e/README.md`)

- Prefer updating tests to writing new ones. Find the tests of the affected leaves in
  `e2e/leaves.md`; update their locators (the names of the mockups), seeds (`e2e/seeds/*.json`, or
  the second argument of `populate`) and `host.leaf()` ids. Delete tests of behaviour that is gone.
- Add a test only for a flow no test reaches yet, in the spec file of its area: populate, press a
  few buttons, assert. Assert on the widget API with `host.actions`, `host.store` and
  `window.widgetHost`, not on the DOM of the message log.
- `e2e/leaves.md`: every leaf has a row naming the test that reaches it, or why it cannot be
  reached in DevBackend mode and which story shows it.
- While iterating run one file (`npx playwright test e2e/<file>.spec.ts`), then all. Compare
  `leaf-screenshots/<id>.png` (written by the run) with the leaf's PNG for the changed leaves.

## Documents

| file | when | status |
|---|---|---|
| `appDesign.md` | step 1 | living |
| header and comments of `src/appViewModel.ts` | step 2 | living |
| `design/leaves/**`, `design/index.html` | step 3, by the build | generated, committed |
| `e2e/leaves.md` | step 5 | living |
| `implementation_findings.md` and `// TODO-FINDING <name> - <details>` | any step | living, see below |
| `README.md` | when user-visible behaviour, a URL parameter or a test hook call changes | living |
| `src/views/README.md`, `e2e/README.md` | only when a rule or the test harness changes | living |
| `designFeedback.md`, `implementationPlan.md` | never | historical: read the accessibility list "Later, for the implementation" and section 2 (iframe slots) |

Findings: when the change resolves a finding, delete its row and its `TODO-FINDING` bookmark.
When you make a controversial choice, add a row to the table of the area (Name, Where, Question,
Options, Now) and a bookmark at the place in the code; `grep -rn "TODO-FINDING <name>" src e2e`
must find it. Clear deviations without a real choice go to the "Trivial" list as one bullet.

## Rules

- No Element Web or Compound components. No new dependency without asking.
- Never edit generated files (`design/leaves/**`, `design/index.html`, the bindings).
- Do not commit. Screenshots and other temporary files go to a scratch directory outside the
  repository (the one you were given, if any). Delete files with `rm` and full absolute paths.
- Stop every server you started (host 5173, test widgets 5175, Storybook 6006).
- A design question with no obvious answer goes to the user (report it). Do not decide it in the
  code without a finding.

## Checks

```sh
cd packages/widget-host
npx tsc --noEmit
npx vitest run
npx playwright test
npm run design && git status --short design/   # only the leaves you meant to change
node e2e/tools/leaves.mjs
```

Plus the import check of the `widget-host` skill.

## Report

- **Mode and change**: one or two lines.
- **What was done**, per step 1 to 5: the files, or "not needed" and why. `appDesign.md`: lines
  before and after.
- **Leaves**: added, redrawn, removed (ids). **Stories**: added, changed, removed (story ids), the
  story/leaf pairs you compared and the differences left.
- **Findings**: resolved (names deleted) and added (names).
- **Tests**: updated, added, deleted; changes to `e2e/leaves.md`; leaves that cannot be reached.
- **Changes against the plan**: what you did differently and why, what you left out.
- **Checks**: each command with its result (numbers); what you did not run and why.
- **Open points**: design questions for the user, anything unsure, unrelated issues you noticed.
- **How to try it**: the URL (for example `http://localhost:5173/?seed=/e2e/seeds/lab.json`), the
  buttons to press, the story ids.
