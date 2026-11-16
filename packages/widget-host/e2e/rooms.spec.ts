/** The RoomsArea: room panels, the room picker of an empty panel, widget tiles, resizing, fullscreen and the narrow window. */
import { expect, LAB, LEGACY_WIDGET, NEW_WIDGET, test, widgetId } from "./host";

const STANDUP = "!standup:dev.local";
const NOTES = widgetId(STANDUP, "m.widget/notes");
const NEW = widgetId(LAB, NEW_WIDGET);

const width = async (panel: import("@playwright/test").Locator) => (await panel.boundingBox())!.width;

test("a new panel shows the picker: no recents, all rooms with search, then the room's widget tiles", async ({ host }) => {
  await host.populate("two-rooms", { sidePanel: null });
  await expect(host.panels).toHaveCount(0);

  await host.leftBar.getByRole("button", { name: /New room panel/ }).click();
  await expect(host.panels).toHaveCount(1);
  const picker = host.page.getByTestId("room-picker");
  await expect(picker.getByText("No recent widgets yet")).toBeVisible();
  await host.leaf("panel/no-recents");

  await picker.getByRole("switch", { name: "Show all rooms" }).click();
  const rows = picker.locator("button.row");
  await expect(rows).toHaveCount(2);
  await host.leaf("panel/all-rooms");

  await picker.getByRole("searchbox", { name: "Search rooms" }).fill("stand");
  await expect(rows).toHaveCount(1);
  await expect(picker.getByRole("status")).toHaveText("1 of 2 rooms match “stand”");

  await rows.first().click();
  await expect(host.panels.first()).toHaveAttribute("data-room-id", STANDUP);
  await expect(host.page.getByTitle("Standup · open the room overview")).toContainText("1 widget");
  await expect(host.page.getByTitle("Standup · open the room overview")).toContainText("2 members");
  await host.leaf("roomview/header");
  const tiles = host.page.getByTestId("widget-tiles");
  await expect(tiles.getByRole("heading", { name: "Widgets in Standup" })).toBeVisible();
  await expect(host.page.getByRole("tab")).toHaveCount(0);
  await host.leaf("roomview/tiles");

  // "Once a widget is selected, it is rendered as the first tab."
  await tiles.getByRole("button", { name: "Open Standup notes" }).click();
  await expect(host.page.getByRole("tab")).toHaveCount(1);
  await expect(host.tab(/Standup notes/)).toHaveAttribute("aria-selected", "true");
  expect(Object.keys((await host.main()).widgets)).toEqual([NOTES]);
});

test("Alt+N opens a panel with the recent widgets; a recent opens its room and the widget", async ({ host }) => {
  await host.populate("two-rooms", { sidePanel: null, behavior: { autoApproveCapabilities: true }, open: [{ room: STANDUP, widgets: ["notes"] }] });

  // Closing the panel closes its tabs: the widget stops.
  await host.button("Close panel").click();
  await expect(host.panels).toHaveCount(0);
  await expect.poll(async () => Object.keys((await host.main()).widgets)).toEqual([]);

  await host.page.keyboard.press("Alt+KeyN");
  await expect(host.panels).toHaveCount(1);
  const recent = host.button("Open Standup notes in Standup");
  await expect(recent).toBeVisible();
  await host.leaf("panel/recents");

  await recent.click();
  await expect(host.panels.first()).toHaveAttribute("data-room-id", STANDUP);
  await expect(host.tab(/Standup notes/)).toHaveAttribute("aria-selected", "true");
  await host.ready(NOTES);
});

test("two panels with different rooms: the separator resizes them, double click resets, a panel closes with its widgets", async ({ host }) => {
  await host.populate("two-rooms", { sidePanel: null, behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET, LEGACY_WIDGET], active: NEW_WIDGET }, { room: STANDUP, widgets: ["notes"] }] });
  await expect(host.panels).toHaveCount(2);
  await expect(host.panels.nth(0)).toHaveAccessibleName("Room panel: Widget lab");
  await expect(host.panels.nth(1)).toHaveAccessibleName("Room panel: Standup");
  await host.ready(NEW);
  await host.ready(NOTES);
  await host.leaf("roomview2/different");

  const [left, right] = [host.panels.nth(0), host.panels.nth(1)];
  const before = { left: await width(left), right: await width(right) };
  expect(Math.abs(before.left - before.right)).toBeLessThan(2);

  const separator = host.page.getByRole("separator", { name: "Resize room panels" });
  const box = (await separator.boundingBox())!;
  await host.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await host.page.mouse.down();
  await host.page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2, { steps: 4 });
  await host.page.mouse.up();
  await expect.poll(() => width(left)).toBeCloseTo(before.left - 150, -1);
  await expect.poll(() => width(right)).toBeCloseTo(before.right + 150, -1);

  await separator.dblclick();
  await expect.poll(() => width(left)).toBeCloseTo(before.left, -1);

  // A third, empty panel on the right of the focused one.
  await right.getByRole("tab", { name: /Standup notes/ }).click();
  await host.page.keyboard.press("Alt+KeyN");
  await expect(host.panels).toHaveCount(3);
  await expect(host.panels.nth(2)).toHaveAccessibleName("Room panel: choose a room");
  await host.leaf("roomsarea/several");

  await host.panels.nth(2).getByRole("button", { name: "Close panel" }).click();
  await right.getByRole("button", { name: "Close panel" }).click();
  await expect(host.panels).toHaveCount(1);
  await expect.poll(async () => Object.keys((await host.main()).widgets)).not.toContain(NOTES);
  expect(Object.keys((await host.main()).widgets)).toContain(NEW);
});

test("Alt+Shift+N opens the same room in a second panel, where the running widget is grayed out", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET, LEGACY_WIDGET], overview: true, active: LEGACY_WIDGET }] });
  await expect(host.panels).toHaveCount(1);
  await expect(host.tab(/Legacy test widget/)).toHaveAttribute("aria-selected", "true");
  await host.ready(widgetId(LAB, LEGACY_WIDGET));
  await host.leaf("roomsarea/one");

  await host.page.keyboard.press("Alt+Shift+KeyN");
  await expect(host.panels).toHaveCount(2);
  await expect(host.panels.nth(1)).toHaveAttribute("data-room-id", LAB);
  await expect(host.panels.nth(1)).toHaveAttribute("data-focused", "true");
  await expect(host.panels.nth(1).getByRole("button", { name: "Jump to the tab of New test widget" })).toBeVisible();
  // A widget runs once per account.
  expect(Object.keys((await host.main()).widgets)).toHaveLength(2);
});

test("fullscreen: LeftBar collapsed and one widget tab hide the tab and the + until the header is hovered or focused", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, leftBarCollapsed: true, behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET] }] });
  await host.ready(NEW);
  await host.page.mouse.move(640, 500);

  await expect(host.page.getByTestId("app")).toHaveClass(/fullscreen/);
  await expect(host.leftBar).toHaveCount(0);
  await expect(host.panels.first()).toHaveCSS("border-top-left-radius", "0px");
  await expect(host.page.getByTitle("Widget lab · open the room overview")).toBeVisible();
  await expect(host.tab(/New test widget/)).toBeHidden();
  await expect(host.button("New tab")).toBeHidden();
  await host.leaf("app/fullscreen");

  await host.page.getByTitle("Widget lab · open the room overview").hover();
  await expect(host.tab(/New test widget/)).toBeVisible();
  await expect(host.button("New tab")).toBeVisible();
  await host.leaf("app/fullscreen-hover");

  // Keyboard focus inside the header shows them as well.
  await host.page.mouse.move(640, 500);
  await expect(host.button("New tab")).toBeHidden();
  await host.page.getByTitle("Widget lab · open the room overview").focus();
  await expect(host.button("New tab")).toBeVisible();

  // A second tab ends the fullscreen view.
  await host.button("New tab").click();
  await expect(host.page.getByTestId("app")).not.toHaveClass(/fullscreen/);
});

test("a narrow window shows only the focused panel, with a pager for the others", async ({ host }) => {
  await host.populate("two-rooms", { sidePanel: null, behavior: { autoApproveCapabilities: true }, open: [{ room: LAB }, { room: STANDUP }] });
  await expect(host.panels).toHaveCount(2);

  await host.page.setViewportSize({ width: 800, height: 800 });
  await expect(host.panels).toHaveCount(1);
  await expect(host.panels.first()).toHaveAttribute("data-room-id", LAB);

  await host.button("Next room panel").click();
  await expect(host.panels).toHaveCount(1);
  await expect(host.panels.first()).toHaveAttribute("data-room-id", STANDUP);
  await expect(host.page.getByRole("group", { name: "Room panels" })).toContainText("Standup · 2 of 2");
});
