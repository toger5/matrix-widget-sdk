# End-to-end tests

Playwright tests of the host in DevBackend mode: no homeserver, no login. `npm run e2e` (starts the host on 5173 and the test widgets on 5175, or reuses running ones).

## How a test looks

```ts
import { expect, LAB, NEW_WIDGET, test, widgetId } from "./host";

test("the dev tools open with the messages panel", async ({ host }) => {
  await host.populate("lab", { open: [{ room: LAB, widgets: [NEW_WIDGET] }] }); // 1. content and screen from a seed
  await host.button("Dev tools of New test widget").click();                    // 2. press a few buttons
  await expect(host.page.getByTestId("devtools-messages")).toBeVisible();       // 3. assert
  await host.leaf("devtools/one-panel");                                        // this screen is that design leaf
});
```

- **One page per worker** (`e2e/host.ts`): the app and its wasm are loaded once. Tests never reload and never tear down; the next `populate` resets everything (widgets stop, panels close, the mocked rooms are replaced).
- **Seeds** are JSON files in `e2e/seeds/` (`HostSeed` in `src/app/controller.ts`): the DevBackend's content (`rooms`, `media`, `userId`, `failSends`) plus the host's (`localWidgets`: the local widgets of "Add widget" per room) and the screen (`open`, `sidePanel`, `settings`, `behavior`, `leftBarCollapsed`). `settings.devBackend` is always on (the DevBackend is active); `settings: { devTools: false }` shows the screens without dev tools. The second argument of `populate` overrides top-level fields, so most tests share `lab.json`.
- **Leaves.** `host.leaf("<id>")` says "this screen is `design/leaves/<id>.html`" and saves a screenshot to `leaf-screenshots/<id>.png`. `e2e/leaves.md` lists every leaf with the test that reaches it, or why it cannot be reached in DevBackend mode. After adding, renaming or removing a leaf, `node e2e/tools/leaves.mjs` lists leaves without a row there, leaf ids in tests, sources and `implementation_findings.md` that no longer exist, and pages in `design/leaves/` to delete.
- **Locators** use roles and accessible names (they are the names of the mockups) and a few `data-testid`s for containers. Playwright pierces the app's shadow root.
- **The widget API** is asserted with `host.actions(widgetId, "fromWidget" | "toWidget")`, `host.store(roomId)` and `window.widgetHost` (`src/app/testHook.ts`), not by reading the message log's DOM. Inside a widget: `host.frame(widgetId).getByRole(…)`.
- `host.dispatch(intent)` sends an intent directly, for a state no button reaches quickly. Prefer buttons.
- `host.token(widgetId)` proves that a widget did not reload.
- **Time.** The fixture installs Playwright's clock before the app loads; it runs like the real one. "Approve" of the capability prompt is blocked for 3 s after the card appeared or a request added to it: `host.passApproveDelay()` jumps over that. `capabilityBoxes(prompt)` are the prompt's capability checkboxes without the sections' "All in …".

A file's tests run in order on one page; files run in parallel workers. A spec file must not depend on another file.
