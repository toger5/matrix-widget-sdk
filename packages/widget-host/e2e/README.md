# End-to-end tests

Playwright tests of the host in DevBackend mode: no homeserver, no login. `npm run e2e` (starts the host on 5173 and the test widgets on 5175, or reuses running ones).

## How a test looks

```ts
import { expect, LAB, NEW_WIDGET, test, widgetId } from "./host";

test("the dev tools open with the messages panel", async ({ host }) => {
  await host.populate("lab", { open: [{ room: LAB, widgets: [NEW_WIDGET] }] }); // 1. content and screen from a seed
  await host.button("Dev tools of New test widget").click();                    // 2. press a few buttons
  await expect(host.page.getByTestId("devtools-messages")).toBeVisible();       // 3. assert
  await host.story("widget-devtools--one-panel");                              // this screen is the state of that story
});
```

- **One page per worker** (`e2e/host.ts`): the app and its wasm are loaded once. Tests never reload and never tear down; the next `populate` resets everything (widgets stop, panels close, the mocked rooms are replaced).
- **Seeds** are JSON files in `e2e/seeds/` (`HostSeed` in `src/app/controller.ts`): the DevBackend's content (`rooms`, `media`, `userId`, `failSends`) plus the host's (`localWidgets`: the local widgets of "Add widget" per room) and the screen (`open`, `sidePanel`, `settings`, `behavior`, `leftBarCollapsed`). `settings.devBackend` is always on (the DevBackend is active); `settings: { devTools: false }` shows the screens without dev tools. The second argument of `populate` overrides top-level fields, so most tests share `lab.json`.
- **Stories.** `host.story("<story id>")` says "this screen is the state of that story" and saves a screenshot to `story-screenshots/<id>.png`, to compare with the story's (`node e2e/tools/shot.mjs story <id> <out.png>`). `e2e/stories.md` lists every story with the tests that mark it, or why it cannot be reached in DevBackend mode (or that it is a sketch or a catalogue story). After adding, renaming or removing a story or a mark, `node e2e/tools/stories.mjs` (`npm run stories`) lists stories without a row there, marks the row does not name, and story ids that do not exist in tests, sources, the docs and the process docs of `.claude/` (the `widget-host-ui` agent, the `widget-host` and `sketch-stories` skills).
- **Locators** use roles and accessible names (they are the names of the stories) and a few `data-testid`s for containers. Playwright pierces the app's shadow root.
- **The widget API** is asserted with `host.actions(widgetId, "fromWidget" | "toWidget")`, `host.store(roomId)` and `window.widgetHost` (`src/app/testHook.ts`), not by reading the message log's DOM. Inside a widget: `host.frame(widgetId).getByRole(…)`.
- `host.dispatch(intent)` sends an intent directly, for a state no button reaches quickly. Prefer buttons.
- `host.token(widgetId)` proves that a widget did not reload.
- **Time.** The fixture installs Playwright's clock before the app loads; it runs like the real one. "Approve" of the capability prompt is blocked for 3 s after the card appeared or a request added to it: `host.passApproveDelay()` jumps over that. `capabilityBoxes(prompt)` are the prompt's capability checkboxes without the sections' "All in …".

A file's tests run in order on one page; files run in parallel workers. A spec file must not depend on another file.
