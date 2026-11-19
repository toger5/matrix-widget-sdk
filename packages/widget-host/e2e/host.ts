/**
 * The fixture of all tests: one page per worker with the host in DevBackend mode, and `host`, a
 * small driver for it. A test starts with `await host.populate("lab")`, which resets the app to
 * the content and screen of `e2e/seeds/lab.json` in a few milliseconds: no reload, no clicking
 * through the DevBackendView.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { type Browser, expect, test as base, type FrameLocator, type Locator, type Page } from "@playwright/test";

import type { HostSeed } from "../src/app/controller";
import { CAPABILITY_APPROVE_DELAY_MS, type AppIntent, type AppViewModel, type MainViewModel } from "../src/appViewModel";

const here = dirname(fileURLToPath(import.meta.url));
const STORIES_DIR = join(here, "../story-screenshots");

export const LAB = "!lab:dev.local";
export const STANDUP = "!standup:dev.local";
/** `widgetKey`s of the two test widgets (`packages/test-widgets`). */
export const NEW_WIDGET = "m.widget/widget-1";
export const LEGACY_WIDGET = "im.vector.modular.widgets/widget-1";
export const widgetId = (roomId: string, widgetKey: string) => `${roomId}|${widgetKey}`;
/** The two test widgets in the lab room. */
export const NEW = widgetId(LAB, NEW_WIDGET);
export const LEGACY = widgetId(LAB, LEGACY_WIDGET);
/** The new test widget with `?autostart=0`: it says nothing until its buttons are pressed. */
export const QUIET = "http://localhost:5175/new/?autostart=0";

/** A room with one widget at `url` (the new test widget's ID), open in a tab. */
export const oneWidget = (url: string, extra: Partial<HostSeed> = {}): HostSeed => ({
  userId: "@alice:dev.local",
  rooms: [{ id: LAB, name: "Widget lab", widgets: [{ type: "m.widget", state_key: "widget-1", content: { name: "New test widget", url, uses_widget_api: true } }] }],
  sidePanel: null,
  open: [{ room: LAB, widgets: [NEW_WIDGET] }],
  ...extra,
});

export class Host {
  constructor(readonly page: Page) {}

  /** Reset the app to a seed: a file name in `e2e/seeds` (without `.json`), optionally changed by `patch`. */
  async populate(seed: string | HostSeed, patch: Partial<HostSeed> = {}): Promise<void> {
    const base: HostSeed = typeof seed === "string" ? (JSON.parse(readFileSync(join(here, "seeds", `${seed}.json`), "utf8")) as HostSeed) : seed;
    await this.page.evaluate((s) => window.widgetHost!.populate(s), { ...base, ...patch });
  }

  /** Send an intent directly, for states no button leads to quickly. */
  dispatch(intent: AppIntent): Promise<void> {
    return this.page.evaluate((i) => window.widgetHost!.dispatch(i), intent);
  }

  state(): Promise<AppViewModel> {
    return this.page.evaluate(() => window.widgetHost!.state());
  }

  async main(): Promise<MainViewModel> {
    const vm = await this.state();
    if (vm.screen.kind !== "main") throw new Error(`the app shows the ${vm.screen.kind} screen`);
    return vm.screen.main;
  }

  /** The actions of the envelopes a widget sent (`fromWidget`) or received (`toWidget`), oldest first. */
  actions(id: string, direction: "fromWidget" | "toWidget"): Promise<string[]> {
    return this.page.evaluate(
      ([i, d]) =>
        window
          .widgetHost!.messages(i)
          .filter((m) => m.direction === d && !("response" in (m.message as object)))
          .map((m) => (m.message as { action: string }).action),
      [id, direction] as const,
    );
  }

  /** What the DevBackend holds for a mocked room. */
  store(roomId: string): Promise<{ timeline: Record<string, unknown>[]; state: Record<string, unknown>[]; delayed: unknown[]; toDeviceSent: unknown[] }> {
    return this.page.evaluate((r) => window.widgetHost!.store(r) as never, roomId);
  }

  /** The capabilities the widget's driver granted. */
  approved(id: string): Promise<string[]> {
    return this.page.evaluate((i) => window.widgetHost!.driverSnapshot(i)?.approved ?? [], id);
  }

  /** How often the widget was started (`widget/reload`, Retry and webview restarts count up). */
  async generation(id: string): Promise<number | undefined> {
    return (await this.main()).widgets[id]?.generation;
  }

  /** Point the lab room's new test widget (its state event) at `url`; a running widget keeps its page until it is reloaded. */
  async repointNewWidget(url: string): Promise<void> {
    await this.dispatch({ type: "roomTools/sendState", roomId: LAB, event: { type: "m.widget", stateKey: "widget-1", content: { name: "New test widget", url, uses_widget_api: true } } });
    await expect
      .poll(async () => {
        const rooms = (await this.main()).data.rooms;
        return rooms.status === "ready" ? rooms.value.find((r) => r.id === LAB)?.widgetEvents?.find((e) => e.type === "m.widget")?.content.url : undefined;
      })
      .toBe(url);
  }

  /** A button of the test widget, pressed with a DOM click: the widget may be loading, covered by a prompt, or in a tab that is not shown. */
  press(id: string, label: string): Promise<void> {
    return this.frame(id).locator("button", { hasText: label }).first().dispatchEvent("click");
  }

  /** What the test widget requests the next time its `request_capabilities` is pressed. */
  async requestNext(id: string, capabilities: string[]): Promise<void> {
    await this.frame(id)
      .locator("#caps")
      .evaluate((input: HTMLInputElement, value) => (input.value = value), capabilities.join(","));
  }

  /** Press `set_always_on_screen true` in the test widget and wait until the host took it. */
  async alwaysOnScreen(id: string): Promise<void> {
    await this.frame(id).getByRole("button", { name: "set_always_on_screen true" }).click();
    await expect.poll(async () => (await this.main()).widgets[id]?.alwaysOnScreen, { message: `${id} is always on screen` }).toBe(true);
  }

  /** The iframe of a running widget. */
  frame(id: string): FrameLocator {
    return this.page.frameLocator(`iframe[data-widget-id="${id}"]`);
  }
  iframe(id: string): Locator {
    return this.page.locator(`iframe[data-widget-id="${id}"]`);
  }

  /** Wait until a widget reported that it is ready and is shown. */
  async ready(id: string): Promise<void> {
    await expect.poll(async () => (await this.main()).widgets[id]?.load.state, { message: `widget ${id} is ready` }).toBe("ready");
  }

  /**
   * A token that lives in the widget's page: it changes if the iframe reloads. Used to prove
   * that moving a widget on screen does not reload it.
   */
  async token(id: string): Promise<string> {
    return this.frame(id)
      .locator("body")
      .evaluate((body) => {
        const w = body.ownerDocument.defaultView as Window & { __token?: string };
        return (w.__token ??= String(Math.random()));
      });
  }

  /**
   * Let the time pass in which "Approve" of the capability prompt is blocked after the last
   * request: the page's clock (installed by the fixture) jumps ahead. Call it once the prompt
   * shows what is to be approved.
   */
  async passApproveDelay(): Promise<void> {
    await this.page.clock.fastForward(CAPABILITY_APPROVE_DELAY_MS);
  }

  /** Pass the delay and press "Approve <selected> selected" of the capability prompt (any number when left out). */
  async approve(selected?: number): Promise<void> {
    await this.passApproveDelay();
    await this.prompt.getByRole("button", { name: selected === undefined ? /^Approve \d+ selected$/ : `Approve ${selected} selected` }).click();
  }

  /**
   * This screen is the state of the story `id` (a Storybook story id, `app-appshell--fullscreen`):
   * saves a screenshot to `story-screenshots/<id>.png` for comparison with the story's
   * (`e2e/tools/shot.mjs story <id>`). `e2e/stories.md` lists which test marks which story.
   */
  async story(id: string): Promise<void> {
    mkdirSync(STORIES_DIR, { recursive: true });
    await this.page.screenshot({ path: join(STORIES_DIR, `${id}.png`), animations: "disabled" });
  }

  /**
   * Drag `handle` (a panel header, a tab) in the RoomsArea's dock to `to` (viewport px): press, move
   * past the drag threshold, then to `to`. With `target` (a `data-dock-target`, e.g. `newRow:1`,
   * `into:<panel id>`) it waits until that target is the active one. `release: false` keeps the
   * button down (to press Escape).
   */
  async drag(handle: Locator, to: { x: number; y: number }, { target, release = true }: { target?: string; release?: boolean } = {}): Promise<void> {
    const box = (await handle.boundingBox())!;
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const mouse = this.page.mouse;
    await mouse.move(from.x, from.y);
    await mouse.down();
    await mouse.move(from.x + 8, from.y + 8, { steps: 2 });
    await expect(this.page.getByTestId("dock-overlay")).toBeVisible();
    await mouse.move(to.x, to.y, { steps: 8 });
    if (target !== undefined) await expect(this.page.locator('[data-dock-drop="active"]')).toHaveAttribute("data-dock-target", target);
    if (release) {
      await mouse.up();
      await expect(this.page.getByTestId("dock-overlay")).toHaveCount(0);
    }
  }

  /** The selected text, also inside the app's shadow root (where `document.getSelection()` sees none; Chromium's `ShadowRoot.getSelection`). */
  selectedText(): Promise<string> {
    return this.page.evaluate(() => {
      const roots = [...document.querySelectorAll("*")].flatMap((el) => (el.shadowRoot ? [el.shadowRoot] : []));
      const texts = [document.getSelection()?.toString() ?? "", ...roots.map((r) => (r as ShadowRoot & { getSelection?(): Selection | null }).getSelection?.()?.toString() ?? "")];
      return texts.join("");
    });
  }

  /** A point in an element: `fx`, `fy` are fractions of its width and height (0.5, 0.5: the middle). */
  async at(el: Locator, fx: number, fy: number): Promise<{ x: number; y: number }> {
    const box = (await el.boundingBox())!;
    return { x: box.x + box.width * fx, y: box.y + box.height * fy };
  }

  // Frequently used elements, by the names of the stories.
  get leftBar(): Locator {
    return this.page.getByTestId("leftbar");
  }
  get panels(): Locator {
    return this.page.getByTestId("room-panel");
  }
  get pip(): Locator {
    return this.page.getByTestId("pip");
  }
  /** The main screen (`.app`): carries the classes `fence`, `narrow` and `fullscreen`. */
  get app(): Locator {
    return this.page.getByTestId("app");
  }
  /** The SidePanel column; `data-view` says which view it shows. Not in the DOM while closed. */
  get sidePanel(): Locator {
    return this.page.getByTestId("sidepanel");
  }
  get roomsArea(): Locator {
    return this.page.getByTestId("roomsarea");
  }
  get toast(): Locator {
    return this.page.getByTestId("toast");
  }
  get prompt(): Locator {
    return this.page.getByTestId("capability-prompt");
  }
  get overview(): Locator {
    return this.page.getByTestId("room-overview");
  }
  /** The DevBackendView in the SidePanel (the Dev tools while the DevBackend is active). */
  get devBackendView(): Locator {
    return this.page.getByTestId("devbackend-view");
  }
  tab(name: string | RegExp): Locator {
    return this.page.getByRole("tab", { name });
  }
  button(name: string | RegExp): Locator {
    return this.page.getByRole("button", { name });
  }
}

export const test = base.extend<{ host: Host }, { hostPage: Page }>({
  // One page for all tests of a worker: the wasm module and the app are loaded once.
  hostPage: [
    async ({ browser }, use) => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ["clipboard-read", "clipboard-write"] });
      const page = await context.newPage();
      page.on("pageerror", (e) => console.error(`page error: ${e.message}`));
      // A clock the tests can move (`passApproveDelay`). It runs on its own like the real one.
      await page.clock.install();
      await page.goto("/?mode=memory");
      await page.waitForFunction(() => window.widgetHost?.state().screen.kind === "main");
      await use(page);
      await context.close();
    },
    { scope: "worker" },
  ],
  host: async ({ hostPage }, use) => {
    await hostPage.setViewportSize({ width: 1280, height: 800 });
    await use(new Host(hostPage));
  },
});

/** A host in a browser context of its own (empty storage, no installed clock), for what happens at start. Close it with `host.page.context().close()`. */
export async function freshHost(browser: Browser): Promise<Host> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  return new Host(await context.newPage());
}

/** The checkboxes of the capabilities in a capability prompt, without those of the sections ("All in …"). */
export const capabilityBoxes = (prompt: Locator, checked?: boolean): Locator => prompt.getByRole("checkbox", { name: /^(?!All in )/, checked });

/** The toggle of a panel in the bar of the room dev tools inside `scope` (its accessible name is "State, 5"). */
export const roomToolsToggle = (scope: Locator, panel: "State" | "Timeline"): Locator =>
  scope.getByRole("toolbar", { name: "Room dev tools" }).getByRole("button", { name: new RegExp(`^${panel}(,|$)`) });

export { expect };
