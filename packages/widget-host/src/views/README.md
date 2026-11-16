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
- sends intents with `useDispatch()` and reads the data that is not in the view model with the hooks of `useViewEnv()` (`src/views/env.tsx`): `useDevToolsData`, `useMockedRoomData`, `useRoomDetails`, `useRoomTimeline`, `avatar`, `narrow`;
- keeps **view state** that nobody else needs in `useState` (a form draft, a hover, a filter text, an open menu, which log row is expanded);
- never imports `src/app/**`, `src/session.ts` values (types are fine), a session implementation, or the bindings;
- derives instead of storing: use the functions at the bottom of `appViewModel.ts` (`widgetTab`, `widgetSlot`, `pipWidgetIds`, `fullscreenWidget`, `activeWorkspace`, …) and `src/views/helpers.ts` (`roomWidgets`, `roomOf`, `readyRooms`).

## Markup and styles

The mockups are the specification. `design/src/components.mjs` has one function per view that returns its HTML, `design/src/leaves.mjs` composes them into the leaves (states) listed in `design/index.html`, and `design/mock.css` styles them. `src/styles/app.css` started as a copy of `mock.css`.

- Port the markup of the mockup function 1:1 (same elements, same class names, same `aria-*`, same `title`s), replacing the fixture data with props. Do not restyle.
- Atoms are in `src/views/ui/atoms.tsx`: `Icon`, `Logo`, `Avatar`, `DevAvatar`, `IconButton` (`ibtn`), `Button` (`btn`), `Toggle`, `Field`, `Json`.
- Form pieces several views share: `src/views/ui/forms.tsx` (`FormChips`, `JsonArea`, `FormError`, `parseJsonObject`, `pretty`) and `src/views/forms/widgetForms.tsx` (the widget and Element Call forms of "Send state" and "Add widget").
- New CSS goes to the end of `src/styles/app.css`, under a comment naming the view. Only tokens (`var(--…)`), no raw colors. Do not edit existing rules that other views use. Do not change `design/` while implementing a view: a mockup change is a design step (step 3 of [`.claude/agents/widget-host-ui.md`](../../../../.claude/agents/widget-host-ui.md)), and then the same rule changes in `mock.css` and `app.css`.
- A running widget is shown with `<WidgetSlot widgetId>` (`src/views/ui/WidgetSlot.tsx`), never with an `<iframe>`.
- Mock-only decoration (fake widget content `.w-*`, the `.stage` wrappers) is not ported.

## Accessibility and tests

The Playwright tests find elements by role and accessible name, so the names of the mockups are part of the contract.

- Every interactive element is a `<button>`, `<a>` or form control with an accessible name (the visible label, or `aria-label` = the mockup's `title`).
- Keep the `data-testid`s of the stub you replace, and add these data attributes where the element stands for one: `data-panel-id`, `data-tab-id`, `data-widget-id`, `data-room-id`, `data-widget-key`.
- Follow the "Later, for the implementation" list of the accessibility review in `designFeedback.md` where it is cheap (roles, `aria-expanded`, labels for inputs, Escape closes menus). Note what you skipped.

## Stories

One `<View>.stories.tsx` next to the view, with **2 to 5 stories** that match leaves (name the leaf in a comment). Use `src/views/fixtures.ts` (`mainVm`, `devMainVm`, `widgetVm`, `roomPanel`, `DEV_TOOLS_DATA`, `MOCKED_ROOM_DATA`, …); add what is missing there only if another view could use it, else keep it in the story file. The preview (`.storybook/preview.tsx`) provides `StoryEnv`; wrap a story in `<StoryEnv env={{…}}>` to override it. Views that are positioned by the app shell need a sized wrapper in the story (`<div className="app" style={{ width: 1100, height: 700 }}>`).

```ts
import type { Meta, StoryObj } from "@storybook/react-vite";
const meta: Meta<typeof LeftBar> = { title: "App/LeftBar", component: LeftBar };
export default meta;
export const Expanded: StoryObj<typeof LeftBar> = { args: { … } }; // leaf leftbar/expanded
```

## Checking a view against its mockup

Storybook runs on port 6006 (`npm run storybook`). Compare screenshots:

```sh
node e2e/tools/shot.mjs leaf  leftbar/expanded      /tmp/…/leaf.png          # the mockup, at its own size
node e2e/tools/shot.mjs story app-leftbar--expanded /tmp/…/story.png 68 620  # your story, same size; add `light` for the light theme
```

The story id is the title in kebab case, `--`, the export name in kebab case. The script prints page and console errors.
