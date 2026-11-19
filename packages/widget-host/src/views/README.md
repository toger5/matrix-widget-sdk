# Views

The views of the widget host, one folder per area of `appDesign.md`. Read this before changing a view.

## MVVM

| layer | where | rule |
| --- | --- | --- |
| Model | `src/app/runtime`, `src/matrix_session`, the bindings | sessions, backends, drivers, iframes |
| View model | `src/appViewModel.ts`, held by `src/app/controller.ts` | one serialisable `AppViewModel`; changed only by `AppIntent`s and by the controller's own events |
| View | `src/views/**` | renders a slice of the view model; sends intents |

A view

- gets its slice of the view model as **props** (the `…Props` interface at the top of its file is its contract: extend it with optional props only, unless the design changes it; then update the parent and the stories in the same change);
- sends intents with `useDispatch()` and reads the data that is not in the view model with the hooks of `useViewEnv()` (`src/views/env.tsx`);
- keeps **view state** that nobody else needs in `useState` (a draft, a hover, a filter, an open menu);
- never imports `src/app/**`, `src/session.ts` values (types are fine), a session implementation, or the bindings;
- derives instead of storing: the functions at the bottom of `appViewModel.ts` (`widgetTab`, `widgetSlot`, `pipWidgetIds`, …) and `src/views/helpers.ts`.

## Markup and styles

The stories are the visual specification, with `appDesign.md`. A state that is designed but not built yet is a sketch story (`Sketch/…`, [`.claude/skills/sketch-stories/SKILL.md`](../../../../.claude/skills/sketch-stories/SKILL.md)); port its markup 1:1 (elements, class names, `aria-*`, `title`s), replacing the literals with props. Do not restyle.

- Atoms: `src/views/ui/atoms.tsx` (icons only from `ICONS` of `src/views/ui/icons.ts`); story `ui-atoms--atoms` shows them all. Shared form pieces: `src/views/ui/forms.tsx`, `src/views/forms/widgetForms.tsx`.
- A running widget is shown with `<WidgetSlot widgetId>` (`src/views/ui/WidgetSlot.tsx`), never with an `<iframe>`.
- Story-only decoration (`.storybook/mockup.css`: the fake widgets `.w-*`, the `.stage` wrappers) is not ported.

The stylesheet is plain CSS per area; `src/styles/app.css` lists the files and explains the cascade layers (`test/styles.test.ts` checks the list). The design rules are `src/styles/<area>.css`; the app-only rules (real inputs, scrolling, resizing, hover) are `src/views/<area>/<file>.css`.

- New CSS of a view goes to its app-only file, under a comment naming the view; a new file is listed in `app.css` (a view never imports CSS: that would reach the document, not the shadow root). Only tokens (`var(--…)`), no raw colors. Do not edit rules other views use.
- Do not change `src/styles/<area>.css` while implementing a view: that is a design step (step 3 of [`.claude/agents/widget-host-ui.md`](../../../../.claude/agents/widget-host-ui.md)) and changes every story at once.
- Theme selectors are `[data-theme=…]`: `:root` does not reach into the shadow root.

## Accessibility and tests

The Playwright tests find elements by role and accessible name, so the names in the stories are part of the contract.

- Every interactive element is a `<button>`, `<a>` or form control with an accessible name (the visible label, or `aria-label` = the `title` of the button). See also `appDesign.md`, Details › Accessibility.
- Keep existing `data-testid`s, and add `data-panel-id`, `data-tab-id`, `data-widget-id`, `data-room-id`, `data-widget-key` where the element stands for one.

## Stories

Every state of the UI is one story: the states of "Required visualisations" of `appDesign.md`, the states a test marks (`host.story`) and the states a finding names. One story per state, at the level where the state lives (a component when it is the component's state, `App/AppShell` when it is a screen; `App/Complete` holds screens with several features at once). Every story has a row in `e2e/stories.md`; `node e2e/tools/stories.mjs` checks it (no server needed).

- `<View>.stories.tsx` next to the view, title `<Area>/<View>`; the id is the kebab-case title, `--`, the kebab-case export name (`App/LeftBar` › `DevBackendHover` → `app-leftbar--dev-backend-hover`). No `meta.id`, no `name`.
- A JSDoc comment on each story: what the state shows.
- `args` over `render`. Fixtures are in `src/views/fixtures.ts`; add there only what another story could use.
- `parameters.size: [width, height]`: the size the state is drawn for (default 1280 × 800). `shot.mjs` shoots at that size; the stages (`SideStage`, `storySize()`) fill it.
- Interaction states come from `play` (`fillIn()` and `findElement()` of `src/views/storyEnv.tsx`) or from the view's `initial…` / `force…` props. A `play` waits with `findBy…`, never a fixed delay, and throws when an element is missing (`getBy…`, never `?.click()`).
- Full screens render `AppShell` through `Screen` (`src/views/app/storyScreen.tsx`). A `WidgetSlot` shows `FakeWidget` of `src/views/storyEnv.tsx`. Wrap a story in `<StoryEnv env={{…}}>` to override the env; pin a theme with `globals: { theme: "light" }`.

## Screenshots

With Storybook running (`npm run storybook`, port 6006):

```sh
node e2e/tools/shot.mjs story app-leftbar--expanded /tmp/…/story.png              # at its parameters.size; add `light` for the light theme
node e2e/tools/shot.mjs url http://localhost:5173/?seed=/e2e/seeds/lab.json /tmp/…/app.png 1280 800
```

A Playwright run saves the screen of every `host.story("<id>")` to `story-screenshots/<id>.png`. For a change that should not change any pixel, `shot.mjs all <dir>` writes every story plus a hash of the computed styles; run it before and after (twice before: a few stories vary between runs) and `diff -rq` the directories.
