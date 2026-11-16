/** The PictureInPicturePanel with several always-on-screen widgets. leaves pip/* (`pip/idle-1` and `pip/hover`: widgetMove.spec.ts) */
import type { Locator } from "@playwright/test";

import type { PipViewModel } from "../src/appViewModel";
import { expect, type Host, LAB, test, widgetId } from "./host";

/** `six-widgets.json`: "Widget 1" … "Widget 6", six copies of the new test widget in one room. */
const W = (n: number) => widgetId(LAB, `m.widget/w${n}`);
const keys = (count: number) => Array.from({ length: count }, (_, i) => `m.widget/w${i + 1}`);

/**
 * Open the first `count` widgets, press `set_always_on_screen true` in each, and select the room
 * name (the room overview): all of them are in the PiP panel then.
 */
async function pinned(host: Host, count: number): Promise<void> {
  await host.populate("six-widgets", { open: [{ room: LAB, widgets: keys(count), overview: true }] });
  for (let n = 1; n <= count; n++) {
    await activate(host, `Widget ${n}`);
    await host.frame(W(n)).getByRole("button", { name: "set_always_on_screen true" }).click();
    await expect.poll(async () => (await host.main()).widgets[W(n)]?.alwaysOnScreen, { message: `Widget ${n} is always on screen` }).toBe(true);
  }
  await activate(host, "Widget lab");
  await expect(boxes(host)).toHaveCount(Math.min(count, 4));
}

/** Press a tab at its start: on a narrow inactive tab the ⋯ and × buttons that appear on hover cover its middle. */
const activate = (host: Host, name: string) => host.tab(name).click({ position: { x: 12, y: 10 } });
/** The surround fades in: wait for the end of that animation before a screenshot. */
const surroundShown = (host: Host) => host.pip.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)).then(() => undefined));
const boxes = (host: Host): Locator => host.pip.getByTestId("pip-box");
const boxOf = (host: Host, n: number): Locator => host.pip.locator(`[data-testid="pip-box"][data-widget-id="${W(n)}"]`);
const rects = (host: Host) => boxes(host).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number }));
const pipVm = async (host: Host): Promise<PipViewModel> => Object.values((await host.main()).workspaces)[0].pip;
const running = async (host: Host) => Object.keys((await host.main()).widgets);
/** Away from the panel: the surround goes after a short delay. */
const idle = async (host: Host) => {
  await host.page.mouse.move(5, 5);
  await expect(host.pip).toHaveAttribute("data-surround", "false");
};

test("four always-on-screen widgets: four boxes; hover and focus show the surround without moving the boxes", async ({ host }) => {
  await pinned(host, 4);
  await expect(host.pip).toHaveAttribute("data-stacking", "horizontal");
  await expect(host.pip.getByTestId("pip-more")).toHaveCount(0);
  for (let n = 1; n <= 4; n++) await expect(host.iframe(W(n))).toBeVisible();
  await idle(host);
  const before = await rects(host);
  expect(new Set(before.map((r) => r.y)).size).toBe(1);
  expect(before.map((r) => r.x)).toEqual([...before.map((r) => r.x)].sort((a, b) => a - b));
  await host.leaf("pip/idle-4");

  await host.pip.hover();
  await expect(host.pip).toHaveAttribute("data-surround", "true");
  await expect(host.pip).toContainText("Always on screen");
  for (let n = 1; n <= 4; n++) {
    await expect(host.pip.getByText(`Widget ${n}`, { exact: true })).toBeVisible();
    await expect(host.pip.getByRole("button", { name: `Go to Widget ${n}` })).toBeVisible();
    await expect(host.pip.getByRole("button", { name: `Stop Widget ${n}` })).toBeVisible();
  }
  await expect(host.pip.getByText("Widget lab")).toHaveCount(4);
  expect(await rects(host)).toEqual(before);

  // The keyboard shows the same surround.
  await idle(host);
  await host.pip.focus();
  await host.page.keyboard.press("Shift");
  await expect(host.pip).toHaveAttribute("data-surround", "true");
  await expect(host.pip.getByRole("button", { name: "Stack vertically" })).toBeVisible();
  expect(await rects(host)).toEqual(before);
});

test("the stacking switch puts the boxes below each other", async ({ host }) => {
  await pinned(host, 3);
  await host.pip.hover();
  await host.pip.getByRole("button", { name: "Stack vertically" }).click();
  await expect(host.pip).toHaveAttribute("data-stacking", "vertical");
  expect((await pipVm(host)).stacking).toBe("vertical");
  await idle(host);
  const before = await rects(host);
  expect(new Set(before.map((r) => r.x)).size).toBe(1);
  expect(before.map((r) => r.y)).toEqual([...before.map((r) => r.y)].sort((a, b) => a - b));
  await host.leaf("pip/vertical");

  await host.pip.hover();
  await expect(host.pip.getByRole("button", { name: "Stack horizontally" })).toBeVisible();
  await expect(host.pip.getByRole("button", { name: "Go to Widget 2" })).toBeVisible();
  expect(await rects(host)).toEqual(before);
  await surroundShown(host);
  await host.leaf("pip/hover-vertical");

  await host.pip.getByRole("button", { name: "Stack horizontally" }).click();
  await expect(host.pip).toHaveAttribute("data-stacking", "horizontal");
  expect(new Set((await rects(host)).map((r) => r.y)).size).toBe(1);
});

test("more widgets than boxes: the overflow button and its menu go to or stop the others", async ({ host }) => {
  await pinned(host, 6);
  const more = host.pip.getByRole("button", { name: "2 more always-on-screen widgets" });
  await expect(more).toHaveText("+2");
  await expect(boxes(host)).toHaveCount(4);
  // The widgets without a box keep running.
  expect(await running(host)).toHaveLength(6);
  await idle(host);
  await host.leaf("pip/overflow");

  await more.click();
  const menu = host.page.getByRole("menu", { name: "More always-on-screen widgets" });
  await expect(menu.getByRole("menuitem")).toHaveCount(4);
  await expect(menu).toContainText("Widget 5");
  await expect(menu).toContainText("Widget 6");
  await expect(menu.getByRole("menuitem", { name: "Go to Widget 5" })).toBeFocused();
  await surroundShown(host);
  await host.leaf("pip/overflow-menu");

  // Esc closes the menu and gives the focus back to the button.
  await host.page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();

  const token = await host.token(W(5));
  await more.click();
  await menu.getByRole("menuitem", { name: "Go to Widget 5" }).click();
  await expect(menu).toHaveCount(0);
  await expect(host.tab("Widget 5")).toHaveAttribute("aria-selected", "true");
  await expect(host.iframe(W(5))).toBeVisible();
  expect(await host.token(W(5))).toBe(token);
  await expect(boxes(host)).toHaveCount(4);
  await expect(host.pip.getByTestId("pip-more")).toHaveText("+1");

  // Stopping asks first: the widget still wants to be on screen.
  await host.pip.getByTestId("pip-more").click();
  await menu.getByRole("menuitem", { name: "Stop Widget 6" }).click();
  const modal = host.page.getByRole("alertdialog");
  await expect(modal).toContainText("Stop Widget 6?");
  await modal.getByRole("button", { name: "Stop the widget" }).click();
  await expect(host.pip.getByTestId("pip-more")).toHaveCount(0);
  await expect(host.tab("Widget 6")).toHaveCount(0);
  expect(await running(host)).not.toContain(W(6));
  await expect(boxes(host)).toHaveCount(4);
});

test("go to a widget activates its tab and removes its box; stop asks for confirmation", async ({ host }) => {
  await pinned(host, 2);
  const tokens = [await host.token(W(1)), await host.token(W(2))];
  await host.pip.hover();
  await host.pip.getByRole("button", { name: "Go to Widget 1" }).click();
  await expect(host.tab("Widget 1")).toHaveAttribute("aria-selected", "true");
  await expect(boxes(host)).toHaveCount(1);
  await expect(boxOf(host, 1)).toHaveCount(0);
  await expect(boxOf(host, 2)).toBeVisible();
  expect(await host.token(W(1))).toBe(tokens[0]);

  await host.pip.hover();
  await host.pip.getByRole("button", { name: "Stop Widget 2" }).click();
  const modal = host.page.getByRole("alertdialog");
  await expect(modal).toContainText("Stop Widget 2?");
  await expect(modal).toContainText("The widget asked to stay on screen");
  await modal.getByRole("button", { name: "Cancel" }).click();
  await expect(boxes(host)).toHaveCount(1);
  expect(await host.token(W(2))).toBe(tokens[1]);

  await host.pip.hover();
  await host.pip.getByRole("button", { name: "Stop Widget 2" }).click();
  await modal.getByRole("button", { name: "Stop the widget" }).click();
  await expect(host.pip).toHaveCount(0);
  await expect(host.tab("Widget 2")).toHaveCount(0);
  await expect(host.iframe(W(2))).toHaveCount(0);
  expect(await running(host)).toEqual([W(1)]);
});

test("the surround drags the panel, the corner resizes the boxes, the arrow keys do both; the widget does not reload", async ({ host }) => {
  await pinned(host, 1);
  const token = await host.token(W(1));
  expect(await pipVm(host)).toMatchObject({ position: { x: 24, y: 24 }, boxSize: { width: 224, height: 140 } });
  const start = (await rects(host))[0];

  // Drag the grip row of the surround.
  await host.pip.hover();
  const grip = (await host.pip.getByText("Always on screen").boundingBox())!;
  await host.page.mouse.move(grip.x + 10, grip.y + 5);
  await host.page.mouse.down();
  await host.page.mouse.move(grip.x - 290, grip.y - 195, { steps: 4 });
  await host.page.mouse.up();
  await expect.poll(() => pipVm(host)).toMatchObject({ position: { x: 324, y: 224 } });
  await expect.poll(async () => (await rects(host))[0]).toMatchObject({ x: start.x - 300, y: start.y - 200, width: 224, height: 140 });
  expect(await host.token(W(1))).toBe(token);

  // Drag the resize corner: the box grows, its top left corner stays.
  const corner = (await host.pip.getByTestId("pip-resize").boundingBox())!;
  await host.page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await host.page.mouse.down();
  await host.page.mouse.move(corner.x + corner.width / 2 + 100, corner.y + corner.height / 2 + 60, { steps: 4 });
  await host.page.mouse.up();
  await expect.poll(() => pipVm(host)).toMatchObject({ boxSize: { width: 324, height: 200 }, position: { x: 224, y: 164 } });
  await expect.poll(async () => (await rects(host))[0]).toMatchObject({ x: start.x - 300, y: start.y - 200, width: 324, height: 200 });
  expect(await host.token(W(1))).toBe(token);

  // Arrow keys move the focused panel, Shift+arrow resizes it.
  await host.pip.focus();
  await host.page.keyboard.press("ArrowLeft");
  await host.page.keyboard.press("ArrowUp");
  await expect.poll(() => pipVm(host)).toMatchObject({ position: { x: 240, y: 180 } });
  await host.page.keyboard.press("Shift+ArrowRight");
  await host.page.keyboard.press("Shift+ArrowDown");
  await expect.poll(() => pipVm(host)).toMatchObject({ boxSize: { width: 340, height: 216 } });
  await expect.poll(async () => (await rects(host))[0]).toMatchObject({ x: start.x - 316, y: start.y - 216, width: 340, height: 216 });
  expect(await host.token(W(1))).toBe(token);

  // It cannot leave the window.
  for (let i = 0; i < 80; i++) await host.page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await pipVm(host)).position.x).toBeLessThan(24);
  const edge = (await rects(host))[0];
  expect(edge.x + edge.width).toBeLessThanOrEqual(1280);
});

test("closing the room panel of an always-on-screen widget keeps it running in the PiP panel; go to reopens the room", async ({ host }) => {
  await host.populate("six-widgets", { open: [{ room: LAB, widgets: keys(1) }] });
  await host.frame(W(1)).getByRole("button", { name: "set_always_on_screen true" }).click();
  await expect.poll(async () => (await host.main()).widgets[W(1)]?.alwaysOnScreen).toBe(true);
  const token = await host.token(W(1));

  await host.panels.getByRole("button", { name: "Close panel" }).click();
  await expect(host.panels).toHaveCount(0);
  await expect(boxOf(host, 1)).toBeVisible();
  await expect(host.iframe(W(1))).toBeVisible();
  expect(await running(host)).toEqual([W(1)]);
  expect(await host.token(W(1))).toBe(token);

  await host.pip.hover();
  await host.pip.getByRole("button", { name: "Go to Widget 1" }).click();
  await expect(host.panels).toHaveCount(1);
  await expect(host.tab("Widget 1")).toHaveAttribute("aria-selected", "true");
  await expect(host.pip).toHaveCount(0);
  await expect(host.iframe(W(1))).toBeVisible();
  expect(await host.token(W(1))).toBe(token);
});

test("the dev tools of a widget stay open inside its PiP box, which can be enlarged for them", async ({ host }) => {
  await host.populate("six-widgets", { open: [{ room: LAB, widgets: keys(2), overview: true }] });
  for (const n of [1, 2]) {
    await activate(host, `Widget ${n}`);
    await host.frame(W(n)).getByRole("button", { name: "set_always_on_screen true" }).click();
    await expect.poll(async () => (await host.main()).widgets[W(n)]?.alwaysOnScreen).toBe(true);
  }
  await activate(host, "Widget 1");
  await host.button("Dev tools of Widget 1").click();
  await expect(host.page.getByTestId("devtools-messages")).toBeVisible();
  const token = await host.token(W(1));
  await activate(host, "Widget lab");

  // Enlarge with the keyboard: Shift+arrow on the focused panel.
  await host.pip.focus();
  for (let i = 0; i < 12; i++) await host.page.keyboard.press("Shift+ArrowRight");
  for (let i = 0; i < 20; i++) await host.page.keyboard.press("Shift+ArrowDown");
  await expect.poll(() => pipVm(host)).toMatchObject({ boxSize: { width: 416, height: 460 } });
  const first = boxOf(host, 1);
  await expect(first.getByRole("toolbar", { name: "Widget dev tools" })).toBeVisible();
  await expect(first.getByTestId("devtools-messages")).toBeVisible();
  await expect(boxOf(host, 2).getByRole("toolbar")).toHaveCount(0);
  await expect(host.iframe(W(1))).toBeVisible();
  expect(await host.token(W(1))).toBe(token);
  // Only the box with open dev tools offers to close them.
  await expect(host.pip.getByRole("button", { name: "Close dev tools" })).toHaveCount(1);
  await surroundShown(host);
  await host.leaf("pip/enlarged-devtools");

  // With dev tools disabled no box shows them or offers to close them.
  await host.dispatch({ type: "settings/set", settings: { devTools: false } });
  await expect(host.pip.getByRole("button", { name: "Close dev tools" })).toHaveCount(0);
  await expect(first.getByRole("toolbar")).toHaveCount(0);
  await host.dispatch({ type: "settings/set", settings: { devTools: true } });
  await expect(host.pip.getByRole("button", { name: "Close dev tools" })).toHaveCount(1);

  await host.pip.getByRole("button", { name: "Close dev tools" }).click();
  await expect(first.getByRole("toolbar")).toHaveCount(0);
  await expect(host.pip.getByRole("button", { name: "Close dev tools" })).toHaveCount(0);
  expect(await host.token(W(1))).toBe(token);
});
