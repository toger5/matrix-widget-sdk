/**
 * The fixture of all tests: one page per worker with the host in DevBackend mode, and `host`, a
 * small driver for it. A test starts with `await host.populate("lab")`, which resets the app to
 * the content and screen of `e2e/seeds/lab.json` in a few milliseconds: no reload, no clicking
 * through the DevBackendView.
 */
import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test as base, type FrameLocator, type Locator, type Page } from "@playwright/test";

import type { HostSeed } from "../src/app/controller";
import { CAPABILITY_APPROVE_DELAY_MS, type AppIntent, type AppViewModel, type MainViewModel } from "../src/appViewModel";

const here = dirname(fileURLToPath(import.meta.url));
const LEAVES_DIR = join(here, "../leaf-screenshots");

export const LAB = "!lab:dev.local";
/** `widgetKey`s of the two test widgets (`packages/test-widgets`). */
export const NEW_WIDGET = "m.widget/widget-1";
export const LEGACY_WIDGET = "im.vector.modular.widgets/widget-1";
export const widgetId = (roomId: string, widgetKey: string) => `${roomId}|${widgetKey}`;

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

  /** This screen is the design leaf `id` (`design/leaves/<id>.html`): saves a screenshot next to the others for comparison. */
  async leaf(id: string): Promise<void> {
    const path = join(LEAVES_DIR, `${id}.png`);
    mkdirSync(dirname(path), { recursive: true });
    await this.page.screenshot({ path, animations: "disabled" });
  }

  // Frequently used elements, by the names of the mockups.
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

/** The checkboxes of the capabilities in a capability prompt, without those of the sections ("All in …"). */
export const capabilityBoxes = (prompt: Locator, checked?: boolean): Locator => prompt.getByRole("checkbox", { name: /^(?!All in )/, checked });

export { expect };
