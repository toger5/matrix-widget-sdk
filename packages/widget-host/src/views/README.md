# Views

The views of the widget host, one folder per area of `appDesign.md`. Read this before changing a view.

## MVVM

| layer | where | rule |
| --- | --- | --- |
| Model | `src/app/runtime`, `src/matrix_session`, the bindings | sessions, backends, drivers, iframes |
| View model | `src/appViewModel.ts`, held by `src/app/controller.ts` | one serialisable `AppViewModel`; changed only by `AppIntent`s and by the controller's own events |
| View | `src/views/**` | renders a slice of the view model; sends intents |

A view

- gets its slice of the view model as **props** (the `…Props` interface at the top of its file is the contract with its parent: extend it with optional props only, unless the design changes the contract; then update the parent and the stories in the same change);
- sends intents with `useDispatch()` and reads the data that is not in the view model with the hooks of `useViewEnv()` (`src/views/env.tsx`): `useDevToolsData`, `useMockedRoomData`, `useRoomDetails`, `useRoomTimeline`, `useRoomState` (read again on `roomStateVersion` of the timeline), `avatar`, `narrow`;
- keeps **view state** that nobody else needs in `useState` (a form draft, a hover, a filter text, an open menu, which log row is expanded);
- never imports `src/app/**`, `src/session.ts` values (types are fine), a session implementation, or the bindings;
- derives instead of storing: use the functions at the bottom of `appViewModel.ts` (`widgetTab`, `widgetSlot`, `pipWidgetIds`, `fullscreenWidget`, `activeWorkspace`, …) and `src/views/helpers.ts` (`roomWidgets` with `useViewEnv().widgetEvents`, `roomOf`, `readyRooms`).

## Markup and styles

The stories are the visual specification, with `appDesign.md` (see "Stories" below). A state that is designed but not built yet is a sketch story (`Sketch/…`, [`.claude/skills/sketch-stories/SKILL.md`](../../../../.claude/skills/sketch-stories/SKILL.md)): static markup with the atoms and the CSS of the app.

- Port the markup of the sketch 1:1 (same elements, same class names, same `aria-*`, same `title`s), replacing the literals with props. Do not restyle. A view without a sketch keeps the markup of its stories.
- Atoms are in `src/views/ui/atoms.tsx`: `Icon` (the icons are `ICONS` of `src/views/ui/icons.ts`, their only source), `Logo`, `Avatar`, `DevAvatar`, `IconButton`, `Button`, `Toggle`, `Field`, `Json`. Story `ui-atoms--atoms` shows them all.
- Form pieces several views share: `src/views/ui/forms.tsx` (`FormChips`, `JsonArea`, `FormError`, `parseJsonObject`, `pretty`) and `src/views/forms/widgetForms.tsx` (the widget and Element Call forms of "Send state" and "Add widget").
- A running widget is shown with `<WidgetSlot widgetId>` (`src/views/ui/WidgetSlot.tsx`), never with an `<iframe>`.
- Story-only decoration (the fake widgets `.w-*`, the `.stage` wrappers) is not ported.

The stylesheet is plain CSS in files per area, in the cascade layers `tokens, base, atoms, views` (a rule of a later layer wins whatever its specificity):

| file | holds | layer |
| --- | --- | --- |
| `src/styles/<area>.css` (`tokens`, `base`, `atoms`, `shell`, `sidepanel`, `devbackend`, `rooms`, `devtools`, `widget`, `pip`) | the design rules: with the stories, the specification | its name, else `views` |
| `src/views/<area>/<file>.css` (`ui/atoms`, `app/shell`, `sidepanel/sidepanel`, `devbackend/devbackend`, `rooms/rooms`, `widget/devtools`, `widget/widget`, `pip/pip`) | the app-only rules of the design file of the same name: what the stories do not draw (real inputs, scrolling, resizing, hover states) | as the design file, after the design files of that layer |
| `.storybook/mockup.css` | stages and fake widgets: stories only | `views` |

`src/styles/app.css` (the app; `src/main.tsx` adopts it into the shadow root, Vite inlines the imports) only lists the files (`test/styles.test.ts` checks the list); `.storybook/preview.css` adds `mockup.css` to `app.css`. In the `views` layer the order of the areas matters where their classes meet (`.caps` of the dev tools before `.prompt-card` of the widget view).

- New CSS of a view goes to its app-only file, under a comment naming the view (a new file is listed in `src/styles/app.css`; a view never imports CSS: that would reach the document, not the shadow root). Only tokens (`var(--…)`), no raw colors. Do not edit existing rules that other views use.
- Do not change `src/styles/<area>.css` while implementing a view: a change of the design rules is a design step (step 3 of [`.claude/agents/widget-host-ui.md`](../../../../.claude/agents/widget-host-ui.md)), and it changes the app and every story at once.
- Theme selectors are `[data-theme=…]`: `:root` does not reach into the shadow root, and the stories put `data-theme` on `<html>`.

## Accessibility and tests

The Playwright tests find elements by role and accessible name, so the names in the stories (and sketches) are part of the contract.

- Every interactive element is a `<button>`, `<a>` or form control with an accessible name (the visible label, or `aria-label` = the `title` of the button).
- Keep the `data-testid`s of the stub you replace, and add these data attributes where the element stands for one: `data-panel-id`, `data-tab-id`, `data-widget-id`, `data-room-id`, `data-widget-key`.
- Follow the "Later, for the implementation" list of the accessibility review in `designFeedback.md` where it is cheap (roles, `aria-expanded`, labels for inputs, Escape closes menus). Note what you skipped.

## Stories

Every state of the UI is one story: the states of "Required visualisations" of `appDesign.md`, the states a test marks (`host.story`, `e2e/stories.md`) and the states a finding names. The stories are the catalogue of states, not a sample: write one primary story per state, at the level where the state lives (a component on its own when it is the component's state, an `App/AppShell` composition when it is a screen; `App/Complete` holds whole screens with several features at once). Every story has a row in `e2e/stories.md`; `node e2e/tools/stories.mjs` checks it.

- `<View>.stories.tsx` next to the view, title `<Area>/<View>`; the story id is the title in kebab case, `--`, the export name in kebab case (`App/LeftBar` › `DevBackendHover` → `app-leftbar--dev-backend-hover`). Storybook's default ids: no `meta.id`, no `name`.
- A JSDoc comment on each story: what the state shows, and why it looks as it does where that is not obvious.
- `args` over `render`; a shared `render` on the meta. Use `src/views/fixtures.ts` (`mainVm`, `devMainVm`, `appVm`, `panelsVm`, `widgetVm`, `roomPanel`, `DEV_TOOLS_DATA`, `MOCKED_ROOM_DATA`, …); add what is missing there only if another story could use it, else keep it in the story file.
- `parameters.size: [width, height]`: the size the state is drawn for (default 1280 × 800, a full screen). The preview writes it to `<html data-story-size>`; `shot.mjs` takes the screenshot at that size and the stages (`SideStage`, `storySize()`) fill it.
- Interaction states (hover, focus, an open menu, a filled form) come from `play` (`storybook/test`: `within(canvasElement)…`; `fillIn()` of `src/views/storyEnv.tsx` types into a field) or from the view's `initial…` / `force…` props. Hover is drawn as focus where the view shows the same.
- A `play` function waits for what it needs with `findBy…` (or `findElement()` of `src/views/storyEnv.tsx`), not with a fixed delay, and throws when the element is missing (`getBy…`, never `?.click()`): a play that misses its element would draw another state without telling. `shot.mjs` reports the exception and exits with 1.
- Full screens render `AppShell` through `Screen` (`src/views/app/storyScreen.tsx`) without the shadow root. A `WidgetSlot` shows the fake widget of `ViewEnv.widgetStandIn` (`FakeWidget` of `src/views/storyEnv.tsx`, chosen by the widget key).
- The preview (`.storybook/preview.tsx`) provides `StoryEnv`; wrap a story in `<StoryEnv env={{…}}>` to override it. A story pins a theme with `globals: { theme: "light" }`.
- Sketches (`<View>.sketch.stories.tsx`, `Sketch/…`, tag `sketch`): see the `sketch-stories` skill. When the state is built, the real story takes the sketch's export name and the sketch is deleted.

```ts
import type { Meta, StoryObj } from "@storybook/react-vite";
const meta: Meta<typeof LeftBar> = { title: "App/LeftBar", component: LeftBar, args: { … }, parameters: { size: [68, 620] } };
export default meta;
/** Expanded, dev tools disabled. */
export const Expanded: StoryObj<typeof LeftBar> = {};
```

## Screenshots

Storybook runs on port 6006 (`npm run storybook`). `e2e/tools/shot.mjs` takes a screenshot once Storybook reports the story rendered (after its `play`):

```sh
node e2e/tools/shot.mjs story app-leftbar--expanded /tmp/…/story.png              # at its parameters.size; add `light` for the light theme
node e2e/tools/shot.mjs story sketch-rooms-roomoverview--plain /tmp/…/sketch.png  # a sketch, to compare with the story that implements it
node e2e/tools/shot.mjs url http://localhost:5173/?seed=/e2e/seeds/lab.json /tmp/…/app.png 1280 800
```

The script prints page and console errors. A Playwright run saves the screen of every `host.story("<id>")` to `story-screenshots/<id>.png`, to compare with the story.

A change that should not change any pixel (a CSS refactor) is checked on everything at once: `node e2e/tools/shot.mjs all /tmp/…/before` and `node e2e/tools/shot.mjs all /tmp/…/before light` (into `before/dark` and `before/light`) before the change, the same into `…/after` afterwards, then `diff -rq /tmp/…/before /tmp/…/after`. It writes every story as a PNG plus a hash of the computed style of each element, which also shows changes that draw nothing. Run it twice before the change: a few stories vary from run to run (the stats chart, a countdown, the DevBackendView's timeline, a text caret).
