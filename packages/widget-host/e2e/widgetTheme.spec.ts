/**
 * The theme of a widget. It reaches the widget twice: by CSS (the iframe's `color-scheme` follows
 * the app's theme and becomes `prefers-color-scheme` inside the widget) and as `update_theme`,
 * which the host pushes when the theme changes. See docs/widget-color-scheme.md.
 */
import type { FrameLocator } from "@playwright/test";

import type { HostSeed } from "../src/app/controller";
import { expect, type Host, LAB, LEGACY_WIDGET, NEW_WIDGET, test, widgetId } from "./host";

/** A page that knows nothing of the widget API, served by the test. It opts into both schemes and draws with system colours only. */
const PLAIN = "http://plain.widget.test/";
const PLAIN_PAGE = `<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>Plain page</title>
<p>A page that knows nothing of the widget API.</p><div id="canvas" style="height: 1px; background: Canvas"></div>`;

type WidgetType = "m.widget" | "im.vector.modular.widgets";
const plainWidget = (type: WidgetType): HostSeed => ({
  userId: "@alice:dev.local",
  rooms: [
    {
      id: LAB,
      name: "Widget lab",
      widgets: [{ type, state_key: "plain", content: type === "m.widget" ? { name: "Plain page", url: PLAIN } : { type: "m.custom", name: "Plain page", url: PLAIN, waitForIframeLoad: true } }],
    },
  ],
  settings: { theme: "light" },
  sidePanel: "settings",
  open: [{ room: LAB, widgets: [`${type}/plain`] }],
});

const theme = (host: Host) => host.page.getByRole("radiogroup", { name: "Theme" });
/** What the widget's document sees: `prefers-color-scheme`. */
const scheme = (frame: FrameLocator) => frame.locator("html").evaluate(() => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
/** The `update_theme` requests a widget received, oldest first. */
const themesSent = (host: Host, id: string) =>
  host.page.evaluate(
    (i) =>
      window
        .widgetHost!.messages(i)
        .map((m) => m.message as { action: string; request?: unknown; response?: unknown })
        .filter((m) => m.action.endsWith(".update_theme") && m.response === undefined)
        .map((m) => m.request),
    id,
  );

test.beforeEach(async ({ host }) => {
  await host.page.context().route(`${PLAIN}**`, (route) => route.fulfill({ contentType: "text/html", body: PLAIN_PAGE }));
  // Playwright's colour scheme emulation (the context's default is "light") wins in Chromium over the
  // scheme an iframe passes on to its document: with it the widget would always see "light".
  await host.page.emulateMedia({ colorScheme: null });
});

test.afterEach(async ({ host }) => {
  await host.page.context().unroute(`${PLAIN}**`);
  await host.page.emulateMedia({ colorScheme: "light" });
});

test("a page that knows nothing of the widget API follows the theme by CSS, on a backdrop of its own canvas colour", async ({ host }) => {
  const id = widgetId(LAB, "m.widget/plain");
  await host.populate(plainWidget("m.widget"));
  await host.ready(id);
  const frame = host.frame(id);
  const backdrop = () => host.iframe(id).evaluate((f) => getComputedStyle(f).backgroundColor);
  const canvas = () => frame.locator("#canvas").evaluate((e) => getComputedStyle(e).backgroundColor);

  for (const name of ["Dark", "Light", "Dark"]) {
    await theme(host).getByRole("radio", { name }).click();
    await expect.poll(() => scheme(frame)).toBe(name.toLowerCase());
    // Same scheme, so the widget's canvas is transparent: what shows through must be its own canvas colour (dark text on dark, not on white).
    await expect.poll(async () => (await backdrop()) === (await canvas())).toBe(true);
  }
  expect(await canvas()).not.toBe("rgb(255, 255, 255)");
  // The scheme is set on the iframe itself, not only inherited (WebKit passes on only that): another scheme around the slot does not change it.
  const between = host.page.locator(".wv-widget");
  await between.evaluate((e) => (e.style.colorScheme = "light"));
  expect(await host.iframe(id).evaluate((f) => getComputedStyle(f).colorScheme)).toBe("dark");
  await between.evaluate((e) => (e.style.colorScheme = ""));
  // None of it went over the widget API.
  expect(await host.page.evaluate((i) => window.widgetHost!.messages(i).length, id)).toBe(0);
});

test("behind the compat wrapper the page follows the theme by CSS too", async ({ host }) => {
  const id = widgetId(LAB, "im.vector.modular.widgets/plain");
  await host.populate(plainWidget("im.vector.modular.widgets"));
  await host.ready(id);
  const inner = host.frame(id).frameLocator("iframe");
  await expect.poll(() => scheme(inner)).toBe("light");

  await theme(host).getByRole("radio", { name: "Dark" }).click();
  await expect.poll(() => scheme(inner)).toBe("dark");
  // The wrapper requests `update_theme` only once the legacy widget answered its `capabilities` request, which this page never does.
  expect(await themesSent(host, id)).toEqual([]);
});

test("a loading widget already sees the theme and has its size, but cannot be seen, clicked or tabbed to", async ({ host }) => {
  const NEW = widgetId(LAB, NEW_WIDGET);
  await host.populate({
    userId: "@alice:dev.local",
    // `autostart=0`: the test widget does not send notify_ready by itself.
    rooms: [{ id: LAB, name: "Widget lab", widgets: [{ type: "m.widget", state_key: "widget-1", content: { name: "New test widget", url: "http://localhost:5175/new/?autostart=0", uses_widget_api: true } }] }],
    settings: { theme: "dark" },
    sidePanel: null,
    notifyReadyTimeoutMs: 60_000,
    open: [{ room: LAB, widgets: [NEW_WIDGET] }],
  });
  await expect(host.page.getByTestId("widget-loading")).toBeVisible();
  const iframe = host.iframe(NEW);
  await expect(iframe).toBeHidden();
  // Laid out where it will be shown, so the widget knows its size and the theme's scheme before notify_ready.
  const area = await host.page.locator(".wv-widget").boundingBox();
  const box = await iframe.evaluate((f) => f.getBoundingClientRect().toJSON() as DOMRect);
  expect(box.width).toBe(area!.width);
  expect(box.height).toBe(area!.height);
  await expect.poll(() => scheme(host.frame(NEW))).toBe("dark");
  expect(await host.frame(NEW).locator("html").evaluate(() => innerWidth)).toBe(area!.width);

  // Neither a click on it nor Tab reaches it. (In Chromium a widget can still focus itself by script: docs/widget-color-scheme.md, section 3.)
  await host.page.mouse.click(area!.x + area!.width / 2, area!.y + area!.height / 2);
  for (let i = 0; i < 25; i++) {
    await host.page.keyboard.press("Tab");
    expect(await host.page.evaluate(() => document.activeElement?.tagName)).not.toBe("IFRAME");
  }
  expect(await host.frame(NEW).locator("html").evaluate(() => document.hasFocus())).toBe(false);
});

test("a theme change is pushed as update_theme to the widgets that hold the capability, an OS change too while on System", async ({ host }) => {
  const NEW = widgetId(LAB, NEW_WIDGET);
  const LEGACY = widgetId(LAB, LEGACY_WIDGET);
  await host.populate("lab", {
    settings: { theme: "light" },
    sidePanel: "settings",
    behavior: { autoApproveCapabilities: true },
    open: [{ room: LAB, widgets: [NEW_WIDGET, LEGACY_WIDGET], active: NEW_WIDGET }],
  });
  await host.ready(NEW);
  await host.ready(LEGACY);
  await expect.poll(() => host.page.evaluate((i) => window.widgetHost!.driverSnapshot(i)?.approved ?? [], NEW)).toContainEqual(expect.stringMatching(/\.update_theme$/));
  expect(await themesSent(host, NEW)).toEqual([]);

  await theme(host).getByRole("radio", { name: "Dark" }).click();
  await expect.poll(() => themesSent(host, NEW)).toEqual([{ name: "dark", is_dark: true }]);
  await expect.poll(() => themesSent(host, LEGACY)).toEqual([{ name: "dark", is_dark: true }]);
  await expect(host.frame(NEW).locator("#log")).toContainText(/update_theme .*dark/);
  await expect(host.frame(LEGACY).frameLocator("iframe").locator("#log")).toContainText("theme_change");

  // System on a dark OS: the resolved theme stays dark, nothing is sent. Then the OS turns light.
  await host.page.emulateMedia({ colorScheme: "dark" });
  await theme(host).getByRole("radio", { name: "System" }).click();
  await host.page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => themesSent(host, NEW)).toEqual([
    { name: "dark", is_dark: true },
    { name: "light", is_dark: false },
  ]);
  await expect.poll(() => themesSent(host, LEGACY)).toHaveLength(2);
});
