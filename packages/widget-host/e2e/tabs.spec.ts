/** The tab bar of a room panel: the room name (the first tab), the widget tabs and the Timeline tab, closing, the keyboard, the dev tools button and the overflow menu. */
import { expect, LAB, LEGACY_WIDGET, NEW_WIDGET, test, widgetId } from "./host";

const NEW = widgetId(LAB, NEW_WIDGET);
const LEGACY = widgetId(LAB, LEGACY_WIDGET);
const MANY = "!many:dev.local";
/** The room name tab of the lab room. */
const ROOM = "Widget lab";

const widgets = async (host: import("./host").Host) => Object.keys((await host.main()).widgets);

test.describe("lab room with both widgets open", () => {
  test.beforeEach(async ({ host }) => {
    await host.populate("lab", { sidePanel: null, behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET, LEGACY_WIDGET], active: NEW_WIDGET }] });
  });

  test("the room name is the first tab: it shows the overview, where running widgets offer “Jump to tab”; the + selects it too", async ({ host }) => {
    await expect(host.page.getByRole("tablist", { name: "Tabs of Widget lab" }).getByRole("tab")).toHaveText([/Widget lab/, /New test widget/, /Legacy test widget/]);
    await expect(host.tab(/New test widget/)).toHaveAttribute("aria-selected", "true");
    await expect(host.tab(ROOM)).toHaveAttribute("aria-selected", "false");
    await host.leaf("tabs/widget-active");

    await host.tab(ROOM).click();
    await expect(host.tab(ROOM)).toHaveAttribute("aria-selected", "true");
    await expect(host.page.getByRole("tabpanel", { name: "Widget lab" })).toBeVisible();
    const overview = host.page.getByTestId("room-overview");
    await expect(overview).toBeVisible();
    // Dev tools are enabled: the widget tabs have the ⋯ button. The room name cannot be closed.
    await expect(host.button("Dev tools of New test widget")).toHaveCount(1);
    await expect(host.button(/^Close Widget lab/)).toHaveCount(0);
    await host.leaf("tabs/overview-active");

    // Both widgets run in this panel: grayed out, "Jump to tab" only.
    await expect(overview.locator(".row.opened")).toHaveText([/New test widget.*open in this panel/, /Legacy test widget.*open in this panel/]);
    await expect(overview.locator(".ov-widgets").getByRole("button", { name: /^Open / })).toHaveCount(0);
    await expect(overview.getByRole("button", { name: /^Move .* here$/ })).toHaveCount(0);
    await overview.getByRole("button", { name: "Jump to the tab of Legacy test widget" }).click();
    await expect(host.tab(/Legacy test widget/)).toHaveAttribute("aria-selected", "true");
    await expect(host.iframe(LEGACY)).toBeVisible();

    await host.button("Open a widget").click();
    await expect(host.tab(ROOM)).toHaveAttribute("aria-selected", "true");
    await expect(overview).toBeVisible();
    await expect(host.iframe(LEGACY)).toBeHidden();
    expect(await widgets(host)).toHaveLength(2);
  });

  test("closing a tab stops its widget and shows the neighbour; after the last one the room name is selected. Alt+W closes the shown tab, else the panel once no widget tab is left", async ({ host }) => {
    // With the room name selected, Alt+W closes nothing while widget tabs are left.
    await host.tab(ROOM).click();
    await expect(host.tab(ROOM)).toHaveAttribute("aria-selected", "true");
    await host.page.keyboard.press("Alt+KeyW");
    await expect(host.page.getByRole("tab")).toHaveCount(3);
    await expect(host.panels).toHaveCount(1);
    expect(await widgets(host)).toHaveLength(2);
    await host.tab(/New test widget/).click();

    await host.button("Close New test widget").click();
    await expect(host.tab(/New test widget/)).toHaveCount(0);
    await expect(host.tab(/Legacy test widget/)).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => widgets(host)).toEqual([LEGACY]);
    await expect(host.iframe(NEW)).toHaveCount(0);
    // The tooltips name Alt+W where it applies: the shown tab.
    await expect(host.button("Close panel")).toHaveAttribute("title", "Close panel");
    await expect(host.button("Close Legacy test widget")).toHaveAttribute("title", "Close Legacy test widget (Alt+W)");

    // Held down, Alt+W closes one tab: the repeated keydown (autoRepeat) would close the panel, which now has no widget tab.
    await host.page.keyboard.down("Alt");
    await host.page.keyboard.down("KeyW");
    await host.page.keyboard.down("KeyW");
    await host.page.keyboard.up("KeyW");
    await host.page.keyboard.up("Alt");
    await expect(host.tab(/Legacy test widget/)).toHaveCount(0);
    await expect(host.tab(ROOM)).toHaveAttribute("aria-selected", "true");
    await expect(host.page.getByTestId("room-overview")).toBeVisible();
    await expect.poll(() => widgets(host)).toEqual([]);
    await expect(host.panels).toHaveCount(1);

    // No widget tab is left: Alt+W closes the panel.
    await expect(host.button("Close panel")).toHaveAttribute("title", "Close panel (Alt+W)");
    await host.page.keyboard.press("Alt+KeyW");
    await expect(host.panels).toHaveCount(0);
    await expect(host.page.getByText("No room panel open")).toBeVisible();
  });

  test("a middle click closes an inactive tab without activating it", async ({ host }) => {
    await host.tab(/Legacy test widget/).click({ button: "middle" });
    await expect(host.tab(/Legacy test widget/)).toHaveCount(0);
    await expect(host.tab(/New test widget/)).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => widgets(host)).toEqual([NEW]);
  });

  test("arrow keys move the focus between the tabs, the room name first; Enter activates, Delete closes a widget tab but not the room name and the focus moves on", async ({ host }) => {
    // One tab stop: the shown tab.
    await expect(host.tab(/New test widget/)).toHaveAttribute("tabindex", "0");
    await expect(host.tab(ROOM)).toHaveAttribute("tabindex", "-1");
    await host.tab(/New test widget/).focus();
    await host.page.keyboard.press("ArrowRight");
    await expect(host.tab(/Legacy test widget/)).toBeFocused();
    // Manual activation: the focused tab is not the selected one yet.
    await expect(host.tab(/New test widget/)).toHaveAttribute("aria-selected", "true");
    await host.page.keyboard.press("Enter");
    await expect(host.tab(/Legacy test widget/)).toHaveAttribute("aria-selected", "true");

    await host.page.keyboard.press("ArrowRight"); // wraps around
    await expect(host.tab(ROOM)).toBeFocused();
    await host.page.keyboard.press("End");
    await expect(host.tab(/Legacy test widget/)).toBeFocused();
    await host.page.keyboard.press("Home");
    await expect(host.tab(ROOM)).toBeFocused();
    await host.page.keyboard.press("Delete");
    await expect(host.page.getByRole("tab")).toHaveCount(3);
    await expect(host.tab(ROOM)).toBeFocused();

    // Selected, the room name becomes the tab stop.
    await host.page.keyboard.press("Enter");
    await expect(host.tab(ROOM)).toHaveAttribute("aria-selected", "true");
    await expect(host.tab(ROOM)).toHaveAttribute("tabindex", "0");
    await expect(host.tab(/Legacy test widget/)).toHaveAttribute("tabindex", "-1");

    await host.page.keyboard.press("ArrowRight");
    await expect(host.tab(/New test widget/)).toBeFocused();
    await host.page.keyboard.press("Delete");
    await expect(host.tab(/New test widget/)).toHaveCount(0);
    await expect(host.tab(ROOM)).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => widgets(host)).toEqual([LEGACY]);
    // The focus moves to the tab that followed the closed one, else to the one before it.
    await expect(host.tab(/Legacy test widget/)).toBeFocused();

    // The same for the × pressed with the keyboard: after the last widget tab the room name has the focus.
    await host.button("Close Legacy test widget").focus();
    await host.page.keyboard.press("Enter");
    await expect(host.page.getByRole("tab")).toHaveCount(1);
    await expect(host.tab(ROOM)).toBeFocused();
  });
});

test("the Timeline tab closes like a widget tab: ×, Delete and Alt+W; then Alt+W closes the panel. The room name selects the overview", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET], timeline: true }] });
  await expect(host.page.getByRole("tab")).toHaveText([/Widget lab/, /New test widget/, /Timeline/]);
  await expect(host.tab("Timeline")).toHaveAttribute("aria-selected", "true");
  const overview = host.page.getByTestId("room-overview");
  const open = async () => {
    await host.tab(ROOM).click();
    await expect(overview).toBeVisible();
    await overview.getByRole("button", { name: "Open timeline" }).click();
    await expect(host.tab("Timeline")).toHaveAttribute("aria-selected", "true");
  };

  // ×: the widget tab on its left is shown; the widget kept running behind the timeline.
  await host.button("Close the timeline").click();
  await expect(host.tab("Timeline")).toHaveCount(0);
  await expect(host.tab(/New test widget/)).toHaveAttribute("aria-selected", "true");
  await expect(host.iframe(NEW)).toBeVisible();
  expect(await widgets(host)).toEqual([NEW]);

  // Delete on the focused tab: the focus moves to the tab before it.
  await open();
  await host.tab("Timeline").focus();
  await host.page.keyboard.press("Delete");
  await expect(host.tab("Timeline")).toHaveCount(0);
  await expect(host.tab(/New test widget/)).toBeFocused();

  // Alt+W closes the shown tab; once only the room name is left, the panel.
  await host.button("Close New test widget").click();
  await open();
  await expect(host.page.getByRole("tab")).toHaveText([/Widget lab/, /Timeline/]);
  await expect(host.button("Close panel")).toHaveAttribute("title", "Close panel");
  await host.page.keyboard.press("Alt+KeyW");
  await expect(host.tab("Timeline")).toHaveCount(0);
  await expect(host.tab(ROOM)).toHaveAttribute("aria-selected", "true");
  await expect(overview).toBeVisible();
  await expect(host.button("Close panel")).toHaveAttribute("title", "Close panel (Alt+W)");
  await host.page.keyboard.press("Alt+KeyW");
  await expect(host.panels).toHaveCount(0);
});

test("the dev tools button of a tab only exists while dev tools are enabled, also in the DevBackend", async ({ host }) => {
  // A seed can turn the dev tools off; the DevBackend stays active and enabled.
  await host.populate("lab", { sidePanel: null, settings: { devTools: false }, open: [{ room: LAB, widgets: [NEW_WIDGET] }] });
  await expect(host.tab(/New test widget/)).toBeVisible();
  await expect(host.button("Dev tools of New test widget")).toHaveCount(0);
  await expect(host.button("Close New test widget")).toHaveCount(1);
  await expect(host.app).toHaveClass(/fence/);
  // The Dev tools button stays while the DevBackend is active.
  await expect(host.leftBar.getByRole("button", { name: "Dev tools", exact: true })).toBeVisible();
  expect((await host.state()).settings).toMatchObject({ devTools: false, devBackend: true });

  await host.dispatch({ type: "settings/set", settings: { devTools: true } });
  await expect(host.button("Dev tools of New test widget")).toHaveCount(1);
  await host.button("Dev tools of New test widget").click();
  await expect(host.button("Dev tools of New test widget")).toHaveAttribute("aria-pressed", "true");
});

test("more tabs than fit: the widget tabs scroll behind the room name and the “All tabs” menu lists and activates them", async ({ host }) => {
  const keys = Array.from({ length: 8 }, (_, i) => `m.widget/w${i + 1}`);
  await host.populate("many-widgets", { sidePanel: null, behavior: { autoApproveCapabilities: true }, open: [{ room: MANY, widgets: keys, active: keys[2] }] });
  await host.page.setViewportSize({ width: 1000, height: 800 }); // still wide (not the narrow layout), but too small for eight widget tabs
  const panel = host.panels.first();
  await expect(panel.getByRole("tab")).toHaveCount(9);

  const all = panel.getByRole("button", { name: /^All \d+ tabs$/ });
  await expect(all).toHaveAccessibleName("All 8 tabs");
  await expect(panel.getByTestId("tab-bar")).toHaveClass(/overflowing/);
  // The active tab is scrolled into view, the last one is not; the room name does not scroll.
  await expect(panel.getByRole("tab", { name: /Quick poll/ })).toBeInViewport();
  await expect(panel.getByRole("tab", { name: /Etherpad/ })).not.toBeInViewport();
  await expect(panel.getByRole("tab", { name: "Design crit" })).toBeInViewport();

  await all.click();
  const menu = host.page.getByRole("menu", { name: "All tabs of Design crit" });
  await expect(menu.getByRole("menuitemradio")).toHaveCount(8);
  await expect(menu.getByRole("menuitemradio", { name: /Quick poll/ })).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByRole("menuitemradio", { name: /Quick poll/ })).toBeFocused();
  await host.leaf("tabs/overflow");

  await menu.getByRole("menuitemradio", { name: /Etherpad/ }).click();
  await expect(menu).toHaveCount(0);
  await expect(panel.getByRole("tab", { name: /Etherpad/ })).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByRole("tab", { name: /Etherpad/ })).toBeInViewport();
  await expect(host.iframe(widgetId(MANY, keys[7]))).toBeVisible();

  // The keyboard: ArrowDown opens the menu, Escape closes it and returns the focus.
  await all.press("ArrowDown");
  await expect(menu.getByRole("menuitemradio", { name: /Etherpad/ })).toBeFocused();
  await host.page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(all).toBeFocused();
});
