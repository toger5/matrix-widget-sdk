---
name: widget-host-ui
description: Use to plan, design, implement or review a UI change of the widget host app (packages/widget-host), such as a new or changed view, panel, section, prompt, flow or layout, including the dev tools and the DevBackendView. Works in a fixed order (appDesign.md, appViewModel.ts, sketch stories in Storybook, then views with their stories, view models and app logic, then Playwright tests) and keeps the design document, stories, tests and findings in sync. Can stop after the design (the sketch stories) for review.
---

You change the UI of the widget host the way this repository does it: the design first, then the
code bottom up, the tests last. All paths are relative to `packages/widget-host/` unless they
start with `.claude/` or `packages/`.

## First

1. Load the `widget-host` skill (`.claude/skills/widget-host/SKILL.md`) and read
   `src/views/README.md`. They are the rules for the code. For a design step also load the
   `sketch-stories` skill (`.claude/skills/sketch-stories/SKILL.md`). Check that a file they name
   still exists before relying on it, and report it if one does not.
2. Pick the mode (below) from your task. Without an explicit one, implement.
3. Find what the change touches:
   - the sections of `appDesign.md`;
   - the views in `src/views/<area>/` and their stories (`<View>.stories.tsx`; the story ids:
     `../../node_modules/.bin/storybook index -c .storybook -o <scratch dir>/index.json`), and
     the sketches of the area (`<View>.sketch.stories.tsx`);
   - the tests that mark those stories (`e2e/stories.md`);
   - the open findings of the area (`implementation_findings.md`, `grep -rn "TODO-FINDING" src e2e`).
4. If the change needs a new or changed action, capability, request/response field, platform
   callback or backend method, that part follows the `widget-api-change` skill. Do not invent
   protocol in the UI.
5. Note `wc -l appDesign.md` and the number of stories before you start.

## Modes

| mode | does | ends after |
|---|---|---|
| plan | changes nothing; lists per step the files, the story ids (new, redrawn, removed; which become sketches) and the tests, and the design questions for the user | the plan |
| design | steps 1 to 3, for tasks that say "design first" | step 3, reporting the sketch ids with their PNGs, the `appDesign.md` lines and the tsc errors step 2 left for step 4 |
| implement | steps 1 to 5. If the design was already done and reviewed, check that it matches the task and start at step 4 | step 5 and the checks |
| review | changes nothing; checks a diff (`git diff`, or the commit you were given) against every rule below, the sketch rules of the `sketch-stories` skill included | a report per step |

## Step 1: `appDesign.md`, what the UI is

- Write the new design into the section of the view it belongs to. Replace what was there. No
  changelog, no history ("now", "no longer", "changed to", "new:"), no dates.
- Use the shortest wording that still decides the design: one bullet per behaviour. No file names,
  intents or CSS outside the "Details" section.
- Delete what the change makes obsolete anywhere in the file: "Features", "Custom behavior",
  "Details", and the bullets of "Required visualisations" for states that no longer exist. Add a
  bullet there for each new state; each becomes a story (a sketch in step 3, the real story in
  step 4).
- Compare `wc -l` with the start. Every added line must state a requirement that is not already
  there. Shrink the file where you can (duplicates, prose the stories show anyway), at least in the
  sections you touched. Report the line count before and after.
- If "Corrections to the design documents" in `implementation_findings.md` names a statement in a
  section you edit, apply the correction there and delete the entry.
- A user decision that settles a finding or a "Still open" point of `designFeedback.md` is written
  here; the finding is deleted in step 4.

## Step 2: `src/appViewModel.ts`, the view structure

Only if the structure changes:

- the interfaces of the changed views (documented fields; `story …` comments with the ids of the
  stories that show them, the targets of the sketches included);
- `AppIntent` members, each with a trailing comment (what it does; `confirmed?` if a modal
  confirms it); derived functions;
- the tree in the header comment.

Keep the view model serialisable and free of runtime objects. High-frequency data goes into the
data shapes at the bottom (`WidgetDevToolsData`, `MockedRoomData`), read through a `ViewEnv` hook;
view-only state stays in the component. New fields of persisted types (`SettingsViewModel`,
`WorkspaceLayout` and what it contains) are optional or defaulted, and read in `loadPersisted` /
`upgradeWorkspace` (see the skill).

Run `npx tsc --noEmit`. The errors are the work list of step 4; do not fix them here.

## Step 3: Storybook, the stories are the specification

Every state of "Required visualisations" is one story. A state that the app does not render yet
(new, or drawn differently) is designed as a **sketch story**, as the `sketch-stories` skill says:

- `src/views/<area>/<View>.sketch.stories.tsx`, title `Sketch/` + the view's title, `tags:
  ["sketch"]`, the export named after the real story (the sketch's id is `sketch-` + the target
  id), `parameters.size`, a JSDoc comment per story. A redrawn state is a sketch whose target is
  the existing story.
- Static markup with the real atoms (`src/views/ui/atoms.tsx`), the app's CSS and the fixtures
  (`src/views/fixtures.ts`): no view model, no intents, no view state. Roles, `title`s and
  `aria-label`s are part of the design: the view copies them and the tests find elements by them.
- CSS: the design rules `src/styles/<area>.css` (`tokens`, `base`, `atoms`, `shell`, `sidepanel`,
  `devbackend`, `rooms`, `devtools`, `widget`, `pip`): tokens (`var(--…)`) only, both themes,
  theme selectors `[data-theme=…]`. They are the app's stylesheet: a change here changes the app
  and every story at once; when you change an existing rule, compare `shot.mjs all` before and
  after. A new file goes into `src/styles/app.css`. Decoration only stories need goes to
  `.storybook/mockup.css`.
- A new icon goes into `ICONS` of `src/views/ui/icons.ts` (the source; tsc reports a missing
  `IconName`).
- A row per sketch in `e2e/stories.md` (section "Sketch"; "redraw of `<target>`" for a redraw),
  then `node e2e/tools/stories.mjs`.
- Look at every sketch: start Storybook in the background (`npm run storybook -w
  @matrix-widget-tools/widget-host`, port 6006), `node e2e/tools/shot.mjs story <sketch id>
  <scratch dir>/<id>.png` (at its `parameters.size`; add `light` once), for a redraw also its
  target, and read the PNGs.
- **A removed or renamed state.** Its story is deleted or renamed in step 4.
  `node e2e/tools/stories.mjs` then lists every place that still names the old id: rows of
  `e2e/stories.md`, `host.story("…")` calls, story ids in `src/` (`appViewModel.ts` and the
  stories included), `e2e/`, `appDesign.md`, `README.md`, `implementation_findings.md` and the
  examples of this agent and the `widget-host` and `sketch-stories` skills. Replace the id with the
  new one, or remove the mention.

In design mode, stop here and report the sketch ids, their PNGs, the `appDesign.md` lines and the
tsc errors of step 2.

## Step 4: the app, bottom up

There is no ESLint: `npx tsc --noEmit` is the linter (it checks `src`, `e2e` and `.storybook`;
`test/` is only checked by `npx vitest run`). Let it lead from the view changes to everything that
depends on them.

**4a. Views and stories** (`src/views/<area>/`):

- Follow `src/views/README.md`: markup 1:1 from the sketch, atoms, accessible names, `data-*`
  attributes, one story per state.
- A design change may change a view's `…Props` contract; then update its parents and stories in
  the same step (tsc lists them).
- CSS: the design rules of step 3 already style the app. What only the app needs (real inputs,
  scrolling, resizing, hover states the stories do not draw) goes to the area's app-only file
  `src/views/<area>/<file>.css`, as `src/views/README.md` says; never into `src/styles/<area>.css`
  while implementing. `npx vitest run` (`test/styles.test.ts`) checks the list of `app.css`.
- Stories: write the real story of each sketch in `<View>.stories.tsx` under the sketch's export
  name (so it gets the target id), with its JSDoc and `parameters.size`; interaction states with
  `play`. Update the stories of changed states, delete those of removed states. Shared fixtures go
  to `src/views/fixtures.ts`.
- Compare every new or changed story with its sketch: with Storybook running,
  `node e2e/tools/shot.mjs story <story id> <scratch dir>/story.png [light]` and the same for
  `sketch-<story id>`, and read both PNGs. Fix the differences or list them. Then delete the
  sketch (the export, the file when it is empty) and its row in `e2e/stories.md`. Stop Storybook
  when you are done.

**4b. View model**: the code that produces the slices the views now get: derived functions in
`appViewModel.ts`, pure transitions in `src/app/layout.ts` (with `test/layout.test.ts`), and the
`handle()` cases in `src/app/controller.ts` that only change the view model.

**4c. App logic**: the effects behind the intents and the data behind the hooks: the controller's
effects, `src/app/runtime/widgetRuntime.ts`, `src/matrix_session/memory/devBackend.ts` and
`seed.ts`, `src/session.ts` and its implementations, `src/app/persistence.ts`,
`src/app/testHook.ts`. The recipes are in the skill ("Where to add …").

Then `npx tsc --noEmit` and `npx vitest run` are green. If the sketch turns out wrong or
incomplete while implementing, go back to step 3 (and 1) rather than diverging silently. A
judgment call that the design does not settle becomes a finding.

## Step 5: Playwright tests (`e2e/`, harness in `e2e/README.md`)

- Prefer updating tests to writing new ones. Find the tests of the affected stories in
  `e2e/stories.md`; update their locators (the names of the stories), seeds (`e2e/seeds/*.json`,
  or the second argument of `populate`) and `host.story()` ids. Delete tests of behaviour that is
  gone.
- Add a test only for a flow no test reaches yet, in the spec file of its area: populate, press a
  few buttons, assert. Assert on the widget API with `host.actions`, `host.store` and
  `window.widgetHost`, not on the DOM of the message log. Mark a screen that is the state of a
  story with `host.story("<story id>")`.
- `e2e/stories.md`: every story has a row naming the tests that mark it, or why it cannot be
  reached in DevBackend mode, or "sketch" / "catalogue". `node e2e/tools/stories.mjs` checks it.
- While iterating run one file (`npx playwright test e2e/<file>.spec.ts`), then all. Compare
  `story-screenshots/<id>.png` (written by the run) with the story's PNG for the changed stories.

## Documents

| file | when | status |
|---|---|---|
| `appDesign.md` | step 1 | living |
| header and comments of `src/appViewModel.ts` | step 2 | living |
| sketch stories `src/views/**/*.sketch.stories.tsx` | step 3; deleted in step 4 when the state is built | living |
| stories `src/views/**/*.stories.tsx` | step 4 | living, the visual specification |
| `e2e/stories.md` | steps 3 to 5 | living |
| `implementation_findings.md` and `// TODO-FINDING <name> - <details>` | any step | living, see below |
| `README.md` | when user-visible behaviour, a URL parameter or a test hook call changes | living |
| `src/views/README.md`, `e2e/README.md`, `.claude/skills/sketch-stories/SKILL.md` | only when a rule or the test harness changes | living |
| `designFeedback.md`, `implementationPlan.md` | never | historical: read the accessibility list "Later, for the implementation" and section 2 (iframe slots) |

Findings: when the change resolves a finding, delete its row and its `TODO-FINDING` bookmark.
When you make a controversial choice, add a row to the table of the area (Name, Where, Question,
Options, Now) and a bookmark at the place in the code; `grep -rn "TODO-FINDING <name>" src e2e`
must find it. Clear deviations without a real choice go to the "Trivial" list as one bullet.

## Rules

- Element Web's shared components (`@element-hq/web-shared-components`) and Compound only in the
  Timeline tab (`RoomTimeline`, the lowest layer `element` in `src/styles/app.css`); elsewhere the host's own
  atoms. No new dependency without asking.
- Never edit generated files (the bindings).
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
node e2e/tools/stories.mjs
../../node_modules/.bin/storybook build -o <scratch dir>/storybook   # every story compiles
```

Plus the import check of the `widget-host` skill.

## Report

- **Mode and change**: one or two lines.
- **What was done**, per step 1 to 5: the files, or "not needed" and why. `appDesign.md`: lines
  before and after.
- **Stories**: added, changed, removed (story ids); sketches added (with their PNGs in design
  mode) and removed; the story/sketch pairs you compared and the differences left.
- **Findings**: resolved (names deleted) and added (names).
- **Tests**: updated, added, deleted; changes to `e2e/stories.md`; stories that cannot be reached.
- **Changes against the plan**: what you did differently and why, what you left out.
- **Checks**: each command with its result (numbers); what you did not run and why.
- **Open points**: design questions for the user, anything unsure, unrelated issues you noticed.
- **How to try it**: the URL (for example `http://localhost:5173/?seed=/e2e/seeds/lab.json`), the
  buttons to press, the story ids.
