/** The RoomsArea: room panels, the room picker of an empty panel, a room opening on its overview, resizing, fullscreen and the narrow window. */
import { expect, LAB, LEGACY_WIDGET, NEW_WIDGET, test, widgetId } from "./host";

const STANDUP = "!standup:dev.local";
const NOTES = widgetId(STANDUP, "m.widget/notes");
const NEW = widgetId(LAB, NEW_WIDGET);

const width = async (panel: import("@playwright/test").Locator) => (await panel.boundingBox())!.width;

test("a new panel shows the picker: no recents, all rooms with search, then the room overview", async ({ host }) => {
  await host.populate("two-rooms", { sidePanel: null });
  await expect(host.panels).toHaveCount(0);

  await host.leftBar.getByRole("button", { name: /New room panel/ }).click();
  await expect(host.panels).toHaveCount(1);
  const picker = host.panels.getByTestId("room-picker");
  // No recents yet: only "All rooms", with the list right away.
  await expect(picker.getByRole("heading")).toHaveText(["All rooms 2"]);
  const rows = picker.locator("button.row");
  await expect(rows).toHaveCount(2);
  await host.leaf("panel/no-recents");

  const search = picker.getByRole("searchbox", { name: "Search rooms" });
  await search.fill("nothing");
  await expect(rows).toHaveCount(0);
  await expect(picker.getByRole("status")).toHaveText("No room matches “nothing”");
  // Nothing is above the field: it is at the top already, nothing scrolled.
  expect(await picker.evaluate((el) => el.scrollTop)).toBe(0);
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(rows).toHaveCount(2);
  await expect(picker.getByRole("status")).toHaveText("");

  await search.fill("stand");
  await expect(rows).toHaveCount(1);
  await expect(picker.getByRole("status")).toHaveText("1 of 2 rooms match “stand”");

  // Enter opens the first match.
  await search.press("Enter");
  await expect(host.panels.first()).toHaveAttribute("data-room-id", STANDUP);
  // The room opens on its room name tab, the only tab: the body is the room overview.
  const roomTab = host.page.getByRole("tab", { name: "Standup", exact: true });
  await expect(roomTab).toHaveAttribute("title", "Standup · open the room overview");
  await expect(roomTab.getByTitle("1 widget")).toHaveText("1");
  await expect(roomTab.getByTitle("2 members")).toHaveText("2");
  await expect(roomTab).toHaveAttribute("aria-selected", "true");
  await expect(host.page.getByRole("tab")).toHaveCount(1);
  await host.leaf("roomview/header");
  const overview = host.page.getByTestId("room-overview");
  await expect(overview.getByRole("heading", { name: "Standup", level: 1 })).toBeVisible();

  // A widget opens as a tab after the room name.
  await overview.getByRole("button", { name: "Open Standup notes" }).click();
  await expect(host.page.getByRole("tab")).toHaveText([/Standup/, /Standup notes/]);
  await expect(host.tab(/Standup notes/)).toHaveAttribute("aria-selected", "true");
  expect(Object.keys((await host.main()).widgets)).toEqual([NOTES]);
});

test("Alt+N opens a panel with the recent widgets and rooms: the search scrolls past the tiles, an open widget is jumped to, a recent opens its room and the widget, a room tile its overview", async ({ host }) => {
  await host.populate("two-rooms", { sidePanel: null, behavior: { autoApproveCapabilities: true }, open: [{ room: STANDUP, widgets: ["notes"] }] });
  await host.ready(NOTES);

  await host.page.keyboard.press("Alt+KeyN");
  await expect(host.panels).toHaveCount(2);
  const picker = host.panels.getByTestId("room-picker");
  await expect(picker.getByRole("heading")).toHaveText(["Recent widgets", "Recent rooms", "All rooms 2"]);
  // The widget has a tab in the first panel: marked "open", pressing it jumps there and the picker stays.
  const jump = picker.getByRole("button", { name: "Jump to the tab of Standup notes in Standup" });
  await expect(jump).toContainText("open");
  const roomTiles = picker.getByRole("region", { name: "Recent rooms" }).getByRole("button");
  await expect(roomTiles).toHaveCount(1);
  await expect(roomTiles).toHaveAccessibleName("Open Standup");
  await host.leaf("panel/recents");

  // The search field scrolls to the top when it gets the focus: the tiles go out of view (they stay), the matches show right under it.
  const search = picker.getByRole("searchbox", { name: "Search rooms" });
  await search.focus();
  await expect(picker.getByRole("heading", { name: "Recent widgets" })).not.toBeInViewport();
  const top = async (l: import("@playwright/test").Locator) => (await l.boundingBox())!.y;
  expect((await top(picker.getByRole("heading", { name: /^All rooms/ }))) - (await top(picker))).toBeLessThan(12);
  await search.fill("stand");
  await expect(picker.locator("button.row")).toHaveCount(1);
  await expect(search).toBeInViewport();
  await host.leaf("panel/search");
  await search.press("Escape");

  await jump.click();
  await expect(host.panels.first()).toHaveAttribute("data-focused", "true");
  await expect(host.tab(/Standup notes/)).toHaveAttribute("aria-selected", "true");
  await expect(host.panels.nth(1)).toHaveAccessibleName("Room panel: choose a room");

  // Closing the panel closes its tabs: the widget stops, and its tile opens it again.
  await host.panels.first().getByRole("button", { name: "Close panel" }).click();
  await expect(host.panels).toHaveCount(1);
  await expect.poll(async () => Object.keys((await host.main()).widgets)).toEqual([]);
  await picker.getByRole("button", { name: "Open Standup notes in Standup" }).click();
  await expect(host.panels.first()).toHaveAttribute("data-room-id", STANDUP);
  await expect(host.tab(/Standup notes/)).toHaveAttribute("aria-selected", "true");
  await host.ready(NOTES);

  // A room tile opens the room on its overview: a second view of the room.
  await host.page.keyboard.press("Alt+KeyN");
  await host.panels.nth(1).getByRole("button", { name: "Open Standup", exact: true }).click();
  await expect(host.panels.nth(1)).toHaveAttribute("data-room-id", STANDUP);
  await expect(host.panels.nth(1).getByRole("tab", { name: "Standup", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(Object.keys((await host.main()).widgets)).toEqual([NOTES]);

  // A recent widget whose URL is refused now (widgetUrlProblem) is left out; its room stays a recent room.
  await host.dispatch({ type: "roomTools/sendState", roomId: STANDUP, event: { type: "m.widget", stateKey: "notes", content: { name: "Standup notes", url: "javascript:alert(1)", uses_widget_api: true } } });
  await host.page.keyboard.press("Alt+KeyN");
  await expect(host.panels.nth(2).getByTestId("room-picker").getByRole("heading")).toHaveText(["Recent rooms", "All rooms 2"]);
  expect((await host.main()).data.recentWidgets.map((r) => r.widgetKey)).toEqual(["m.widget/notes"]);
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

test("Alt+Shift+N opens the same room in a second panel, where the running widget is grayed out; Alt+W closes it again", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET, LEGACY_WIDGET], active: LEGACY_WIDGET }] });
  await expect(host.panels).toHaveCount(1);
  await expect(host.tab(/Legacy test widget/)).toHaveAttribute("aria-selected", "true");
  await host.ready(widgetId(LAB, LEGACY_WIDGET));
  await host.leaf("roomsarea/one");

  await host.page.keyboard.press("Alt+Shift+KeyN");
  await expect(host.panels).toHaveCount(2);
  await expect(host.panels.nth(1)).toHaveAttribute("data-room-id", LAB);
  await expect(host.panels.nth(1)).toHaveAttribute("data-focused", "true");
  // It opens on the room overview, where both widgets are open in the other panel.
  await expect(host.panels.nth(1).getByRole("tab", { name: "Widget lab" })).toHaveAttribute("aria-selected", "true");
  await expect(host.panels.nth(1).getByRole("button", { name: "Jump to the tab of New test widget" })).toBeVisible();
  await expect(host.panels.nth(1).getByRole("button", { name: "Move Legacy test widget here" })).toBeVisible();
  // A widget runs once per account.
  expect(Object.keys((await host.main()).widgets)).toHaveLength(2);

  // The second panel has no widget tab: Alt+W closes it, the widgets of the same room in the first panel keep running.
  await host.page.keyboard.press("Alt+KeyW");
  await expect(host.panels).toHaveCount(1);
  await expect(host.panels.first()).toHaveAttribute("data-focused", "true");
  await expect(host.tab(/Legacy test widget/)).toHaveAttribute("aria-selected", "true");
  expect(Object.keys((await host.main()).widgets)).toHaveLength(2);
});

test("fullscreen: LeftBar collapsed and one shown widget tab hide the tab and the + until the header is hovered or focused", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, leftBarCollapsed: true, behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET] }] });
  await host.ready(NEW);
  await host.page.mouse.move(640, 500);

  await expect(host.page.getByTestId("app")).toHaveClass(/fullscreen/);
  await expect(host.leftBar).toHaveCount(0);
  await expect(host.panels.first()).toHaveCSS("border-top-left-radius", "0px");
  await expect(host.page.getByTitle("Widget lab · open the room overview")).toBeVisible();
  await expect(host.tab(/New test widget/)).toBeHidden();
  await expect(host.button("Open a widget")).toBeHidden();
  await host.leaf("app/fullscreen");

  await host.page.getByTitle("Widget lab · open the room overview").hover();
  await expect(host.tab(/New test widget/)).toBeVisible();
  await expect(host.button("Open a widget")).toBeVisible();
  await host.leaf("app/fullscreen-hover");

  // Keyboard focus inside the header shows them as well. The room name is the tab stop while the widget tab is hidden.
  await host.page.mouse.move(640, 500);
  await expect(host.button("Open a widget")).toBeHidden();
  await expect(host.page.getByTitle("Widget lab · open the room overview")).toHaveAttribute("tabindex", "0");
  await host.page.getByTitle("Widget lab · open the room overview").focus();
  await expect(host.button("Open a widget")).toBeVisible();

  // Selecting the room name (the + does that too) ends the fullscreen view.
  await host.button("Open a widget").click();
  await expect(host.page.getByTestId("app")).not.toHaveClass(/fullscreen/);
  await expect(host.tab("Widget lab")).toHaveAttribute("aria-selected", "true");
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
