/** The RoomsArea: room panels, the room picker of an empty panel, a room opening on its overview, resizing, dragging panels and tabs, fullscreen and the narrow window. */
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
  await host.story("rooms-roompicker--no-recents");

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
  await host.story("rooms-roomview--overview");
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
  await host.story("rooms-roompicker--recents");

  // The search field scrolls to the top when it gets the focus: the tiles go out of view (they stay), the matches show right under it.
  const search = picker.getByRole("searchbox", { name: "Search rooms" });
  await search.focus();
  await expect(picker.getByRole("heading", { name: "Recent widgets" })).not.toBeInViewport();
  const top = async (l: import("@playwright/test").Locator) => (await l.boundingBox())!.y;
  expect((await top(picker.getByRole("heading", { name: /^All rooms/ }))) - (await top(picker))).toBeLessThan(12);
  await search.fill("stand");
  await expect(picker.locator("button.row")).toHaveCount(1);
  await expect(search).toBeInViewport();
  await host.story("rooms-roompicker--search");
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

  // A recent widget whose URL is refused now (`hostWidgetEvents.resolve` has a `problem`) is left out; its room stays a recent room.
  await host.dispatch({ type: "roomTools/sendState", roomId: STANDUP, event: { type: "m.widget", stateKey: "notes", content: { name: "Standup notes", url: "javascript:alert(1)", uses_widget_api: true } } });
  await host.page.keyboard.press("Alt+KeyN");
  await expect(host.panels.nth(2).getByTestId("room-picker").getByRole("heading")).toHaveText(["Recent rooms", "All rooms 2"]);
  expect((await host.main()).data.recentWidgets.map((r) => r.widgetKey)).toEqual(["m.widget/notes"]);
});

test("Ctrl+K opens the room picker in a dialog: a pick opens the room in a new panel, an open widget is jumped to, Ctrl+K again and Escape close it", async ({ host }) => {
  await host.populate("two-rooms", { sidePanel: null, behavior: { autoApproveCapabilities: true }, open: [{ room: STANDUP, widgets: ["notes"] }] });
  await host.ready(NOTES);
  const dialog = host.page.getByRole("dialog", { name: "Open a room" });
  const search = dialog.getByRole("searchbox", { name: "Search rooms" });

  // The content of an empty panel; the search field has the focus, the recents stay in view.
  await host.page.keyboard.press("ControlOrMeta+KeyK");
  await expect(dialog).toBeVisible();
  await expect(search).toBeFocused();
  await expect(dialog.getByRole("heading")).toHaveText(["Open a room", "Recent widgets", "Recent rooms", "All rooms 2"]);
  await expect(dialog.getByRole("heading", { name: "Recent widgets" })).toBeInViewport();
  await host.story("app-appshell--room-picker-modal");

  // A widget that has a tab is jumped to: no new panel.
  await dialog.getByRole("button", { name: "Jump to the tab of Standup notes in Standup" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(host.panels).toHaveCount(1);

  // Ctrl+K again closes it, Escape too.
  await host.page.keyboard.press("ControlOrMeta+KeyK");
  await expect(dialog).toBeVisible();
  await host.page.keyboard.press("ControlOrMeta+KeyK");
  await expect(dialog).toHaveCount(0);
  await host.page.keyboard.press("ControlOrMeta+KeyK");
  await expect(search).toBeFocused();
  await host.page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // A query and Enter: the first match in a new panel right of the focused one.
  await host.page.keyboard.press("ControlOrMeta+KeyK");
  await search.fill("lab");
  await search.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(host.panels).toHaveCount(2);
  await expect(host.panels.nth(1)).toHaveAttribute("data-room-id", LAB);
  await expect(host.panels.nth(1)).toHaveAttribute("data-focused", "true");
  await expect(host.panels.nth(1).getByRole("tab", { name: "Widget lab", exact: true })).toHaveAttribute("aria-selected", "true");

  // A room tile opens a new panel too, also for a room a panel shows already.
  await host.page.keyboard.press("ControlOrMeta+KeyK");
  await dialog.getByRole("button", { name: "Open Standup", exact: true }).click();
  await expect(host.panels).toHaveCount(3);
  await expect(host.panels.nth(2)).toHaveAttribute("data-room-id", STANDUP);
});

test("two panels with different rooms: the splitter resizes them, double click resets, a panel closes with its widgets", async ({ host }) => {
  await host.populate("two-rooms", { sidePanel: null, behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET, LEGACY_WIDGET], active: NEW_WIDGET }, { room: STANDUP, widgets: ["notes"] }] });
  await expect(host.panels).toHaveCount(2);
  await expect(host.panels.nth(0)).toHaveAccessibleName("Room panel: Widget lab");
  await expect(host.panels.nth(1)).toHaveAccessibleName("Room panel: Standup");
  await host.ready(NEW);
  await host.ready(NOTES);
  await host.story("app-appshell--different-rooms");

  const [left, right] = [host.panels.nth(0), host.panels.nth(1)];
  const before = { left: await width(left), right: await width(right) };
  expect(Math.abs(before.left - before.right)).toBeLessThan(2);

  const separator = host.page.getByRole("separator", { name: "Resize items" });
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
  await host.story("app-appshell--several-panels");

  await host.panels.nth(2).getByRole("button", { name: "Close panel" }).click();
  await right.getByRole("button", { name: "Close panel" }).click();
  await expect(host.panels).toHaveCount(1);
  await expect.poll(async () => Object.keys((await host.main()).widgets)).not.toContain(NOTES);
  expect(Object.keys((await host.main()).widgets)).toContain(NEW);
});

test("a panel dragged by its header moves to a new row (its widget does not reload) and to a side column; Escape cancels", async ({ host }) => {
  await host.populate("two-rooms", { sidePanel: null, behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET] }, { room: STANDUP, widgets: ["notes"] }] });
  await host.ready(NEW);
  await host.ready(NOTES);
  const token = await host.token(NOTES);
  const [lab, standup] = [host.panels.nth(0), host.panels.nth(1)];
  const ids = [await lab.getAttribute("data-panel-id"), await standup.getAttribute("data-panel-id")];

  // Escape cancels: nothing moves.
  await host.drag(standup.getByRole("tab", { name: "Standup", exact: true }), await host.at(host.roomsArea, 0.5, 0.98), { target: "newRow:1", release: false });
  await host.page.keyboard.press("Escape");
  await host.page.mouse.up();
  await expect(host.page.getByTestId("dock-overlay")).toHaveCount(0);
  expect((await host.main()).workspaces[(await host.main()).activeAccountId].roomsArea.dock.center.rows).toHaveLength(1);

  // Below the bottom of the dock: a new row.
  await host.drag(standup.getByRole("tab", { name: "Standup", exact: true }), await host.at(host.roomsArea, 0.5, 0.98), { target: "newRow:1" });
  const m = await host.main();
  expect(m.workspaces[m.activeAccountId].roomsArea.dock.center.rows.map((r) => r.items.map((i) => i.id))).toEqual([[ids[0]], [ids[1]]]);
  const [top, bottom] = [(await lab.boundingBox())!, (await standup.boundingBox())!];
  expect(bottom.y).toBeGreaterThan(top.y + top.height - 1);
  expect(await host.token(NOTES)).toBe(token);
  // Dragging selected no text.
  expect(await host.selectedText()).toBe("");
  // The press on the room name was a drag, not a click: the Standup notes tab is still shown.
  await expect(standup.getByRole("tab", { name: /Standup notes/ })).toHaveAttribute("aria-selected", "true");
  await expect(host.page.getByRole("separator", { name: "Resize rows" })).toBeVisible();

  // A new panel goes right of the focused one (Standup, pressed last); by its header to the right edge: a side column.
  await host.page.keyboard.press("Alt+KeyN");
  await expect(host.panels).toHaveCount(3);
  const picker = host.panels.nth(2);
  await expect(picker).toHaveAccessibleName("Room panel: choose a room");
  await host.drag(picker.locator(".rp-head .sp"), await host.at(host.roomsArea, 0.99, 0.75), { target: "side:right:0" });
  const after = (await host.main()).workspaces[m.activeAccountId].roomsArea.dock;
  expect(after.right?.map((i) => i.id)).toEqual([await picker.getAttribute("data-panel-id")]);
  expect((await picker.boundingBox())!.height).toBeGreaterThan(top.height + bottom.height);
  // No text selected by the press on the free space of the header, and text can be selected again after the release.
  expect(await host.selectedText()).toBe("");
  expect(await host.page.evaluate(() => document.documentElement.style.userSelect)).toBe("");
  await host.story("app-appshell--panel-rows");
});

test("a tab dragged out becomes a panel of its room; dragged onto another panel of the room it joins it; widgets keep running", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET, LEGACY_WIDGET], active: NEW_WIDGET }] });
  await host.ready(NEW);
  const token = await host.token(NEW);
  const first = host.panels.nth(0);
  const firstId = (await first.getAttribute("data-panel-id"))!;

  // To the right edge: a new panel at the end of the row (its own panel is no target).
  await host.drag(host.tab(/New test widget/), await host.at(host.roomsArea, 0.99, 0.5), { target: "between:0:1" });
  await expect(host.panels).toHaveCount(2);
  const second = host.panels.nth(1);
  await expect(second).toHaveAttribute("data-room-id", LAB);
  await expect(second.getByRole("tab", { name: /New test widget/ })).toHaveAttribute("aria-selected", "true");
  await expect(first.getByRole("tab", { name: /New test widget/ })).toHaveCount(0);
  await expect(first.getByRole("tab", { name: /Legacy test widget/ })).toHaveAttribute("aria-selected", "true");
  await expect(second).toHaveAttribute("data-focused", "true");
  expect(await host.token(NEW)).toBe(token);
  expect(await host.selectedText()).toBe("");

  // Back onto the first panel: it joins its tabs; the emptied panel stays on its RoomOverview.
  await host.drag(second.getByRole("tab", { name: /New test widget/ }), await host.at(first, 0.5, 0.5), { target: `into:${firstId}` });
  await expect(host.panels).toHaveCount(2);
  await expect(first.getByRole("tab", { name: /New test widget/ })).toHaveAttribute("aria-selected", "true");
  await expect(second.getByRole("tab", { name: "Widget lab", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(await host.token(NEW)).toBe(token);

  // The emptied panel dragged by its header onto the first one: merged, one panel left.
  await host.drag(second.getByRole("tab", { name: "Widget lab", exact: true }), await host.at(first, 0.5, 0.5), { target: `into:${firstId}` });
  await expect(host.panels).toHaveCount(1);
  await expect(first.getByRole("tab", { name: /New test widget/ })).toHaveAttribute("aria-selected", "true");
  expect(await host.token(NEW)).toBe(token);
});

test("Alt+Shift+N opens the same room in a second panel, where the running widget is grayed out; Alt+W closes it again", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET, LEGACY_WIDGET], active: LEGACY_WIDGET }] });
  await expect(host.panels).toHaveCount(1);
  await expect(host.tab(/Legacy test widget/)).toHaveAttribute("aria-selected", "true");
  await host.ready(widgetId(LAB, LEGACY_WIDGET));
  await host.story("app-appshell--one-panel");

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
  await host.story("app-appshell--fullscreen");

  await host.page.getByTitle("Widget lab · open the room overview").hover();
  await expect(host.tab(/New test widget/)).toBeVisible();
  await expect(host.button("Open a widget")).toBeVisible();
  await host.story("app-appshell--fullscreen-header-focused");

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
