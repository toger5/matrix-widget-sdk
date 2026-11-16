---
name: sketch-stories
description: How a new view or state of the widget host (packages/widget-host) is designed in Storybook before it is built - sketch stories (`<View>.sketch.stories.tsx`, title `Sketch/…`, tag `sketch`) drawn with the app's real atoms, CSS and fixtures, without view model or intents. Covers when to sketch, file, title, export and target id, `parameters.size`, the building blocks with a skeleton, the rules `e2e/tools/stories.mjs` checks, the review with `shot.mjs`, and how a sketch is replaced by the real story. Use in the design step of a UI change (step 3 of the `widget-host-ui` agent), and when reviewing or implementing a sketch.
---

# Sketch stories

Storybook is the visual specification of the widget host: every state of the UI is a story. A state
that is designed but not built yet is a **sketch story**: static markup with the app's own atoms,
stylesheet and fixtures, in the place where the real story will be. It is the design-first
checkpoint: the sketch is reviewed as screenshots before any view, view model or intent changes,
and the view is then ported from it 1:1.

All paths are relative to `packages/widget-host/`. The rules for views and stories are in
`src/views/README.md`; the process of a UI change in `.claude/agents/widget-host-ui.md`.

## When

- A new view, a new state of a view, or a view that looks different: sketch it in step 3 of the
  `widget-host-ui` agent, after `appDesign.md` (step 1) and `appViewModel.ts` (step 2).
- Not for a state the app already renders as designed (write its real story), behaviour that looks
  the same (`appDesign.md` is enough), or a CSS fix (change the CSS and look at the real stories).
- A designed detail that is not built for now stays a sketch, with a finding in
  `implementation_findings.md` that says why (the `Sketch/` stories of today are such details).

## What a sketch is, and is not

A sketch is JSX that renders what the view will render: the same elements, class names, roles,
`title`s and `aria-label`s (the tests will find the elements by these names), built from

- the atoms of `src/views/ui/atoms.tsx` (`Icon`, `Avatar`, `DevAvatar`, `Button`, `IconButton`,
  `Toggle`, `Field`, `Json`, `Logo`) and presentational parts (`src/views/ui/forms.tsx`, an
  area's `parts.tsx` such as `Sub` of `src/views/devbackend/parts.tsx`);
- the stylesheet: the design rules `src/styles/<area>.css`, the app-only rules
  `src/views/<area>/*.css`, the stages of `.storybook/mockup.css` (all loaded by the preview);
- the fixtures of `src/views/fixtures.ts` (`ACCOUNTS`, `ROOMS`, `ROOM_DETAILS`, `WIDGET_EVENTS`,
  `MOCKED_ROOM_DATA`, `DEV_TOOLS_DATA`, …) or literals in the sketch;
- around it, for context, the stages of the stories (`SideStage`, `.stage`, `AppFrame`,
  `SoloPanel`, `InDesignPanel`, `Screen` with a fixture view model) and `FakeWidget` for widget
  content.

A sketch is not a view: no `…Props` contract, no `useDispatch` (no intents), no `useState` /
`useReducer` (draw each state as its own story), no logic that decides what is shown, nothing from
`src/app`. Event handlers that atoms require are no-ops (`onChange={() => {}}`); text that a user
would type is drawn in a `<span className="input">`.

## Files and names

| what | rule | example |
|---|---|---|
| file | `src/views/<area>/<View>.sketch.stories.tsx`, next to the view (or where the new view will be) | `src/views/rooms/RoomOverview.sketch.stories.tsx` |
| title | `Sketch/` + the title of `<View>.stories.tsx`; a new view: `Sketch/<Area>/<View>` | `Sketch/Rooms/RoomOverview` |
| tag | `tags: ["sketch"]` in the meta | |
| export | the name the real story will have | `Plain` |
| id | `sketch-` + the **target**: the id of the real story | `sketch-rooms-roomoverview--plain` → `rooms-roomoverview--plain` |
| size | `parameters.size: [width, height]` on the meta or the story: the size the state is drawn for (default 1280 × 800, a full screen) | `[900, 330]` |
| doc | a JSDoc comment per story: what the state shows; for a redraw, what differs from the target | |
| row | a row in `e2e/stories.md`, section "Sketch": `**sketch**: <what>`; when the target exists `**sketch**, redraw of \`<target>\`: <what>`, plus the finding if it stays a sketch | |

A sketch whose target exists is a **redraw** of that story. Story ids come from the title and the
export name (kebab case, `--` between them); `../../node_modules/.bin/storybook index -c .storybook -o <file>`
lists them without a server.

## Skeleton

```tsx
import type { Meta, StoryObj } from "@storybook/react-vite";

import { ROOM_DETAILS } from "../fixtures"; // fixture data, or literals
import { SideStage } from "../storyEnv"; // a stage for context
import { Avatar, Button, Field, Icon } from "../ui/atoms";

/** Sketches of the MemberList: designed, not built. Static markup with the real atoms and CSS. */
const meta: Meta = { title: "Sketch/SidePanel/MemberList", tags: ["sketch"], decorators: [SideStage], parameters: { size: [348, 620] } };
export default meta;

/** All members of the room, the own account first; the search filters by name and user ID. */
export const AllMembers: StoryObj = {
  render: () => (
    <section className="sidebox" aria-label="Members">
      <Field label="Search">
        <span className="input">al</span>
      </Field>
      <ul className="rows">
        {(ROOM_DETAILS.members ?? []).map((m) => (
          <li key={m.userId} className="row">
            <Avatar name={m.displayName ?? m.userId} id={m.userId} size={24} />
            <span className="row-main">
              <b>{m.displayName}</b>
              <small>{m.userId}</small>
            </span>
          </li>
        ))}
      </ul>
      <Button sm icon="userPlus">Invite</Button>
    </section>
  ),
};
```

(The view and its class names are an example; use the fixtures and classes that exist, and add what
is missing as below.)

- **New CSS** of the design goes to the design rules, `src/styles/<area>.css`: tokens only
  (`var(--…)`), both themes, theme selectors `[data-theme=…]`. These files are the app's
  stylesheet: a rule there changes the app at once, so prefer new class names, and check other
  stories with `shot.mjs all` before and after when you touch an existing rule. A new file is
  listed in `src/styles/app.css` (`test/styles.test.ts` checks the list).
- Decoration only stories need (a stage, a cut) goes to `.storybook/mockup.css`.
- **A new icon** goes into `ICONS` of `src/views/ui/icons.ts`, the only source of the icons
  (stroke paths on a 24px grid).
- **New fixture data** that the real story will need too goes to `src/views/fixtures.ts`.

## Rules

`node e2e/tools/stories.mjs` fails on:

- a sketch that is not all three of: `*.sketch.stories.tsx`, title `Sketch/…`, tag `sketch`;
- a title that is not `Sketch/` + the title of `<View>.stories.tsx` next to it (or, without one,
  does not end in `/<View>`);
- `useDispatch`, `useState` or `useReducer` in a sketch file, or an import from `src/app`;
- a sketch without its row in `e2e/stories.md`, a row without `**sketch**` (or `**sketch**` in the
  row of a story that is no sketch), or a redraw whose row does not say "redraw";
- a story id in `src/`, `e2e/` or the docs (those of the package, this skill, the `widget-host`
  skill and the `widget-host-ui` agent) that is neither a story nor the target of a sketch. The
  examples here name the sketch `sketch-rooms-roomoverview--plain`: when it is built, they change.

Not checked, still required: `parameters.size`; accessible names on everything interactive; text
and data that look real (the fixtures); no raw colors in CSS.

## Review

With Storybook running (`npm run storybook -w @matrix-widget-tools/widget-host`, port 6006):

```sh
node e2e/tools/shot.mjs story sketch-rooms-roomoverview--plain <scratch>/sketch.png        # at parameters.size
node e2e/tools/shot.mjs story sketch-rooms-roomoverview--plain <scratch>/sketch-light.png light
node e2e/tools/shot.mjs story rooms-roomoverview--plain <scratch>/target.png              # a redraw: the target
```

Read the PNGs. The design step delivers the sketch ids, their PNGs (both themes once), the lines
of `appDesign.md` and the tsc errors step 2 left; the reviewer looks at the PNGs and the sketch
source (the names in it are the contract of the tests).

## From sketch to story

1. Implement the view (step 4 of the `widget-host-ui` agent): port the sketch's markup 1:1,
   replacing the literals with props and the view model.
2. Write the real story in `<View>.stories.tsx` under the **same export name** (so it gets the
   target id), with the sketch's JSDoc and `parameters.size`; interaction states with `play`.
3. Shoot both (`shot.mjs story <target>` and `shot.mjs story sketch-<target>`) and compare;
   fix the differences or list them.
4. Delete the sketch export (the file when it is empty) and its row in `e2e/stories.md`; the real
   story's row names the test that marks it (`host.story("<target>")`), or why none can.

A sketch that is dropped from the design is deleted with its row and its finding.

## Checks

```sh
cd packages/widget-host
npx tsc --noEmit
node e2e/tools/stories.mjs
node e2e/tools/shot.mjs story <sketch id> <scratch>/<id>.png
```
