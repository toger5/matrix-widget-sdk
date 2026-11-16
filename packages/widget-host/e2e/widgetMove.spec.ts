/** A widget keeps running while it moves on screen: tab → PictureInPicturePanel → tab → another room panel. */
import { expect, LAB, LEGACY_WIDGET, NEW_WIDGET, test, widgetId } from "./host";

const NEW = widgetId(LAB, NEW_WIDGET);
const LEGACY = widgetId(LAB, LEGACY_WIDGET);

test.beforeEach(async ({ host }) => {
  await host.populate("lab", { sidePanel: null, behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET, LEGACY_WIDGET], active: NEW_WIDGET }] });
  await host.ready(NEW);
});

test("always on screen: the tab gets a pin, moving away shows the widget in the PiP panel, without a reload", async ({ host }) => {
  const token = await host.token(NEW);

  await host.frame(NEW).getByRole("button", { name: "set_always_on_screen true" }).click();
  await expect(host.tab(/New test widget/).locator(".ico")).not.toHaveCount(0);
  await expect(host.pip).toHaveCount(0);
  await host.leaf("tabs/pinned");

  await host.tab(/Legacy test widget/).click();
  await expect(host.pip.getByTestId("pip-box")).toHaveCount(1);
  await expect(host.iframe(NEW)).toBeVisible();
  expect(await host.token(NEW)).toBe(token);
  await host.leaf("pip/idle-1");

  await host.pip.hover();
  await host.leaf("pip/hover");

  await host.tab(/New test widget/).click();
  await expect(host.pip).toHaveCount(0);
  expect(await host.token(NEW)).toBe(token);
});

test("move widget here: the widget changes the room panel without a reload", async ({ host }) => {
  const token = await host.token(NEW);

  await host.page.keyboard.press("Alt+Shift+KeyN");
  await expect(host.panels).toHaveCount(2);
  await host.leaf("roomview2/same");

  await host.panels.nth(1).getByRole("button", { name: "Move New test widget here" }).click();
  await expect(host.panels.nth(1).getByRole("tab", { name: /New test widget/ })).toBeVisible();
  await expect(host.panels.nth(0).getByRole("tab", { name: /New test widget/ })).toHaveCount(0);
  await expect(host.iframe(NEW)).toBeVisible();
  expect(await host.token(NEW)).toBe(token);
});

test("an inactive tab keeps its widget running", async ({ host }) => {
  await host.ready(LEGACY);
  const token = await host.token(NEW);
  await host.tab(/Legacy test widget/).click();
  await expect(host.iframe(NEW)).toBeHidden();
  await expect(host.iframe(LEGACY)).toBeVisible();
  await host.tab(/New test widget/).click();
  expect(await host.token(NEW)).toBe(token);
});
