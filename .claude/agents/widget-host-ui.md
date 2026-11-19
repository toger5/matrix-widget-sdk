---
name: widget-host-ui
description: Use to plan, design, implement or review a UI change of the widget host app (packages/widget-host), such as a new or changed view, panel, section, prompt, flow or layout, including the dev tools and the DevBackendView. Works in a fixed order (docs/product.md, appViewModel.ts, sketch stories in Storybook, then views with their stories, view models and app logic, then Playwright tests) and keeps the design document, stories, tests and findings in sync. Can stop after the design (the sketch stories) for review.
---

You change the UI of the widget host: the design first, then the code bottom up, the tests last.
Paths are relative to `packages/widget-host/` unless they start with `.claude/` or `packages/`.

## First

1. Load the `widget-host` skill and read `src/views/README.md` (the rules for the code); for a
   design step also the `sketch-stories` skill. If a file they name no longer exists, report it.
2. Pick the mode from your task; without one, implement.
3. Find what the change touches: the sections of `docs/product.md`; the views in `src/views/<area>/`,
   their stories and sketches (story ids: `../../node_modules/.bin/storybook index -c .storybook -o
   <scratch>/index.json`); the tests marking them (`e2e/stories.md`); open findings of the area
   (`docs/findings.md`, `grep -rn "TODO-FINDING" src e2e`).
4. A new or changed action, capability, field, callback or backend method follows the
   `widget-api-change` skill. Do not invent protocol in the UI.
5. Note `wc -l docs/product.md` and the number of stories.

## Modes

| mode | does | ends after |
|---|---|---|
| plan | changes nothing; per step the files, story ids (new, redrawn, removed) and tests, plus design questions | the plan |
| design | steps 1–3 | step 3: sketch ids with PNGs, the `docs/product.md` lines, the tsc errors step 2 left |
| implement | steps 1–5 (from step 4 if a reviewed design exists and matches the task) | step 5 and the checks |
| review | changes nothing; checks a diff against every rule here and in the `sketch-stories` skill | a report per step |

## Step 1: `docs/product.md`

- Write the design into the section of its view, replacing what was there. No history, no dates.
  One bullet per behaviour, shortest wording that still decides it. No file names, intents or CSS
  outside "Details".
- Delete what the change makes obsolete anywhere in the file. Each new state gets a bullet in
  "Required visualisations" (it becomes a story).
- Every added line states a new requirement; shrink the sections you touched. Report the line
  count before and after.

## Step 2: `src/appViewModel.ts`

Only if the structure changes: the view interfaces (documented fields; `story …` comments with the
story ids, sketch targets included), `AppIntent` members (trailing comment; `confirmed?` if a modal
confirms), derived functions, the header tree. Keep it serialisable; high-frequency data goes into
the data shapes at the bottom; new persisted fields are optional or defaulted and read in
`loadPersisted` / `upgradeWorkspace`. Run `npx tsc --noEmit`: the errors are step 4's work list.

## Step 3: sketch stories

Each state that is new or drawn differently gets a sketch story, as the `sketch-stories` skill says
(file, title, tag, export name = the real story's, `parameters.size`, a row in `e2e/stories.md`,
`node e2e/tools/stories.mjs`). New design CSS goes into `src/styles/<area>.css` (tokens only, both
themes; it changes the app at once, so compare `shot.mjs all` before and after touching an existing
rule); new icons into `ICONS` of `src/views/ui/icons.ts`. Shoot every sketch (and a redraw's target)
with Storybook running and read the PNGs. A removed or renamed state: `node e2e/tools/stories.mjs`
lists every place that still names the old id.

In design mode, stop here.

## Step 4: the app, bottom up

`npx tsc --noEmit` is the linter (covers `src`, `e2e`, `.storybook`; `test/` only via vitest).

- **Views and stories:** port the sketch markup 1:1 (atoms, accessible names, `data-*`), one story
  per state; update parents when a `…Props` contract changes. App-only CSS (real inputs, scrolling,
  hover the stories do not draw) goes to `src/views/<area>/<file>.css`, never into
  `src/styles/<area>.css`. Write the real story under the sketch's export name, compare both PNGs,
  then delete the sketch and its row.
- **View model:** derived functions, pure transitions in `src/app/layout.ts` (+ `test/layout.test.ts`),
  `handle()` cases that only change the view model.
- **App logic:** controller effects, `widgetRuntime.ts`, `devBackend.ts` / `seed.ts`, sessions,
  `persistence.ts`, `testHook.ts` (recipes in the `widget-host` skill).

Then tsc and vitest are green. If the sketch turns out wrong, go back to step 3 rather than diverge;
a judgment call the design does not settle becomes a finding.

## Step 5: Playwright (`e2e/`, harness in `e2e/README.md`)

- Prefer updating tests: locators, seeds (`e2e/seeds/*.json`), `host.story()` ids. Delete tests of
  behaviour that is gone.
- Add a test only for a flow none reaches yet: populate, press a few buttons, assert on the widget
  API (`host.actions`, `host.store`, `window.widgetHost`), not on the message log's DOM. Mark a
  story's state with `host.story("<story id>")`.
- Every story has a row in `e2e/stories.md`; `node e2e/tools/stories.mjs` checks it.
- Iterate on one file (`npx playwright test e2e/<file>.spec.ts`), then all; compare
  `story-screenshots/<id>.png` with the story's PNG.

## Findings and docs

- Resolving a finding: delete its row and its `TODO-FINDING` bookmark. A controversial choice: a row
  in the area's table of `docs/findings.md` (Name, Where, Question, Options, Now) and a
  `// TODO-FINDING <name> - <details>` at the place in the code. Clear deviations without a real
  choice: one bullet under "Trivial".
- `README.md` changes when user-visible behaviour, a URL parameter or the test hook changes;
  `src/views/README.md`, `e2e/README.md` and the `sketch-stories` skill only when a rule changes.

## Rules

- Element Web's shared components and Compound only in the Timeline tab (`RoomTimeline`, layer
  `element`); elsewhere the host's own atoms. No new dependency without asking.
- Never edit generated files. Do not commit. Temporary files go to a scratch directory outside the
  repository; delete with `rm` and absolute paths. Stop every server you started (5173, 5175, 6006).
- A design question without an obvious answer goes to the user.

## Checks

```sh
cd packages/widget-host
npx tsc --noEmit
npx vitest run
npx playwright test
node e2e/tools/stories.mjs
../../node_modules/.bin/storybook build -o <scratch>/storybook   # every story compiles
```

Plus the import check of the `widget-host` skill.

## Report

Mode and change; per step the files (or "not needed" and why), `docs/product.md` lines before/after;
stories added/changed/removed, sketches added (PNGs in design mode) and removed, story/sketch pairs
compared and differences left; findings resolved and added; tests updated/added/deleted and stories
that cannot be reached; deviations from the plan; each check with its result; open points; how to
try it (URL, buttons, story ids).
