---
name: sketch-stories
description: How a new view or state of the widget host (packages/widget-host) is designed in Storybook before it is built - sketch stories (`<View>.sketch.stories.tsx`, title `Sketch/…`, tag `sketch`) drawn with the app's real atoms, CSS and fixtures, without view model or intents. Covers when to sketch, file, title, export and target id, `parameters.size`, the building blocks with a skeleton, the rules `e2e/tools/stories.mjs` checks, the review with `shot.mjs`, and how a sketch is replaced by the real story. Use in the design step of a UI change (step 3 of the `widget-host-ui` agent), and when reviewing or implementing a sketch.
---

# Sketch stories

Every state of the widget host UI is a story. A state that is designed but not built yet is a
**sketch story**: static markup with the app's own atoms, stylesheet and fixtures, in the place
where the real story will be. It is reviewed as screenshots before any view, view model or intent
changes, and the view is then ported from it 1:1. Paths are relative to `packages/widget-host/`;
view and story rules are in `src/views/README.md`.

## When

- A new view, a new state, or a view that looks different (step 3 of the `widget-host-ui` agent).
- Not for a state the app already renders as designed, behaviour that looks the same, or a CSS fix.
- A designed detail that is not built for now stays a sketch, with a finding in
  `implementation_findings.md` that says why.

## What a sketch is

JSX that renders what the view will render: the same elements, class names, roles, `title`s and
`aria-label`s (the tests will find elements by them), built from the atoms of
`src/views/ui/atoms.tsx`, presentational parts (`src/views/ui/forms.tsx`, an area's `parts.tsx`),
the stylesheet, the fixtures of `src/views/fixtures.ts` (or literals), the story stages of
`src/views/storyEnv.tsx` and `FakeWidget` for widget content.

Not allowed: a `…Props` contract, `useDispatch`, `useState` / `useReducer` (draw each state as its
own story), logic that decides what is shown, anything from `src/app`. Handlers atoms require are
no-ops; typed text is a `<span className="input">`.

## Files and names

| what | rule |
|---|---|
| file | `src/views/<area>/<View>.sketch.stories.tsx`, next to the view (or where it will be) |
| title | `Sketch/` + the title of `<View>.stories.tsx`; a new view: `Sketch/<Area>/<View>` |
| tag | `tags: ["sketch"]` in the meta |
| export | the name the real story will have |
| id | `sketch-` + the target id (the real story's id: title and export in kebab case, `--` between) |
| size | `parameters.size: [width, height]` (default 1280 × 800) |
| doc | a JSDoc comment per story: what the state shows; for a redraw, what differs |
| row | `e2e/stories.md`, section "Sketch": `**sketch**: <what>`; when the target exists (a **redraw**) `**sketch**, redraw of \`<target>\`: <what>` |

## Skeleton

```tsx
import type { Meta, StoryObj } from "@storybook/react-vite";

import { ROOM_DETAILS } from "../fixtures";
import { SideStage } from "../storyEnv";
import { Avatar, Button } from "../ui/atoms";

/** Sketches of the MemberList: designed, not built. */
const meta: Meta = { title: "Sketch/SidePanel/MemberList", tags: ["sketch"], decorators: [SideStage], parameters: { size: [348, 620] } };
export default meta;

/** All members of the room, the own account first. */
export const AllMembers: StoryObj = {
  render: () => (
    <section className="sidebox" aria-label="Members">
      <ul className="rows">
        {(ROOM_DETAILS.members ?? []).map((m) => (
          <li key={m.userId} className="row">
            <Avatar name={m.displayName ?? m.userId} id={m.userId} size={24} />
            <span className="row-main"><b>{m.displayName}</b><small>{m.userId}</small></span>
          </li>
        ))}
      </ul>
      <Button sm icon="userPlus">Invite</Button>
    </section>
  ),
};
```

- New design CSS goes to `src/styles/<area>.css`: tokens only, both themes, `[data-theme=…]`. It
  changes the app at once: prefer new class names, and compare `shot.mjs all` before and after when
  touching an existing rule. A new file is listed in `src/styles/app.css`.
- Story-only decoration: `.storybook/mockup.css`. New icons: `ICONS` in `src/views/ui/icons.ts`.
  Fixture data the real story will need too: `src/views/fixtures.ts`.

## Rules `node e2e/tools/stories.mjs` checks

- A sketch is all three of: `*.sketch.stories.tsx`, title `Sketch/…`, tag `sketch`.
- Its title is `Sketch/` + the sibling `<View>.stories.tsx` title (or ends in `/<View>`).
- No `useDispatch`, `useState`, `useReducer`, no import from `src/app`.
- Its row exists and says `**sketch**` (and "redraw" when the target exists).
- Every story id named in `src/`, `e2e/`, the package docs, this skill, the `widget-host` skill and
  the `widget-host-ui` agent is a story or a sketch target. Use placeholders like `<target>` in docs.

Not checked, still required: `parameters.size`, accessible names, realistic data, no raw colours.

## Review

With Storybook running (`npm run storybook -w @matrix-widget-tools/widget-host`, port 6006):

```sh
node e2e/tools/shot.mjs story sketch-<target> <scratch>/sketch.png          # at parameters.size
node e2e/tools/shot.mjs story sketch-<target> <scratch>/sketch-light.png light
node e2e/tools/shot.mjs story <target> <scratch>/target.png                 # a redraw: the target
```

Read the PNGs. The design step delivers the sketch ids, their PNGs (both themes once), the
`appDesign.md` lines and the tsc errors step 2 left.

## From sketch to story

1. Port the markup 1:1 into the view, replacing literals with props.
2. Write the real story in `<View>.stories.tsx` under the **same export name**, with the sketch's
   JSDoc and `parameters.size`; interaction states with `play`.
3. Shoot both and compare; fix or list the differences.
4. Delete the sketch export (the file when empty) and its row; the real story's row names the test
   that marks it, or why none can.

A sketch dropped from the design is deleted with its row and its finding.
