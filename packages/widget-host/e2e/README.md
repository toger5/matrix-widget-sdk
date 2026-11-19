# End-to-end tests

Playwright tests of the host in DevBackend mode: no homeserver, no login. `npm run e2e` (starts the host on 5173 and the test widgets on 5175, or reuses running ones).

```ts
import { expect, LAB, NEW_WIDGET, test } from "./host";

test("the dev tools open with the messages panel", async ({ host }) => {
  await host.populate("lab", { open: [{ room: LAB, widgets: [NEW_WIDGET] }] }); // 1. content and screen from a seed
  await host.button("Dev tools of New test widget").click();                    // 2. press a few buttons
  await expect(host.page.getByTestId("devtools-messages")).toBeVisible();       // 3. assert
  await host.story("widget-devtools--one-panel");                              // this screen is the state of that story
});
```

- **One page per worker** (`e2e/host.ts`): the app and its wasm are loaded once. Tests never reload; the next `populate` resets everything. A file's tests run in order on one page, files run in parallel: a spec file must not depend on another. `freshHost(browser)` is a page of its own, for what happens at start.
- **Seeds** are JSON files in `e2e/seeds/` (`HostSeed` in `src/app/controller.ts`); the second argument of `populate` overrides top-level fields, so most tests share `lab.json`. `oneWidget(url)` is a seed with one widget.
- **Stories.** `host.story("<id>")` marks the screen as the state of that story and saves `story-screenshots/<id>.png`. `e2e/stories.md` lists every story with the tests that mark it; `npm run stories` checks it.
- **Locators** use roles and accessible names, and a few `data-testid`s for containers (the getters of `Host`). Playwright pierces the app's shadow root.
- **The widget API** is asserted through `window.widgetHost` (`src/app/testHook.ts`: `host.actions`, `host.store`, `host.approved`), not the message log's DOM. Inside a widget: `host.frame(widgetId)`, `host.press(widgetId, label)`. `host.token(widgetId)` proves that a widget did not reload.
- `host.dispatch(intent)` sends an intent directly, for a state no button reaches quickly. Prefer buttons.
- **Time.** The fixture installs Playwright's clock before the app loads. "Approve" of the capability prompt is blocked for 3 s after a request: `host.approve(n)` jumps over that and approves.
