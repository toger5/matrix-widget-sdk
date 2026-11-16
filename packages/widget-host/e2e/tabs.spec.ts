/** The tab bar of a room panel: widget, native and new tabs, closing, the keyboard, the dev tools button and the overflow menu. */
import { expect, LAB, LEGACY_WIDGET, NEW_WIDGET, test, widgetId } from "./host";

const NEW = widgetId(LAB, NEW_WIDGET);
const LEGACY = widgetId(LAB, LEGACY_WIDGET);
const MANY = "!many:dev.local";

const widgets = async (host: import("./host").Host) => Object.keys((await host.main()).widgets);

test.describe("lab room with both widgets and the overview open", () => {
  test.beforeEach(async ({ host }) => {
    await host.populate("lab", { sidePanel: null, behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET, LEGACY_WIDGET], overview: true, active: NEW_WIDGET }] });
  });

  test("widget and native tabs; the + button opens a new tab where running widgets offer “Jump to tab”", async ({ host }) => {
    await expect(host.page.getByRole("tablist", { name: "Tabs of Widget lab" }).getByRole("tab")).toHaveText([/New test widget/, /Legacy test widget/, /Room overview/]);
    await expect(host.tab(/New test widget/)).toHaveAttribute("aria-selected", "true");
    await host.leaf("tabs/widget-active");

    await host.tab("Room overview").click();
    await expect(host.tab("Room overview")).toHaveAttribute("aria-selected", "true");
    await expect(host.page.getByTestId("room-overview")).toBeVisible();
    // Dev tools are enabled: the widget tabs have the ⋯ button.
    await expect(host.button("Dev tools of New test widget")).toHaveCount(1);
    await host.leaf("tabs/native-active");

    await host.button("New tab").click();
    await expect(host.tab("New tab")).toHaveAttribute("aria-selected", "true");
    const tiles = host.page.getByTestId("widget-tiles");
    await expect(tiles.getByRole("heading", { name: "Open another widget" })).toBeVisible();
    await expect(tiles.locator(".tile.opened")).toHaveCount(2);
    await expect(tiles.getByRole("button", { name: /^Open / })).toHaveCount(0);
    await expect(tiles.getByRole("button", { name: /^Move .* here$/ })).toHaveCount(0);
    await host.leaf("roomview/new-tab");

    await tiles.getByRole("button", { name: "Jump to the tab of Legacy test widget" }).click();
    await expect(host.tab(/Legacy test widget/)).toHaveAttribute("aria-selected", "true");
    await expect(host.iframe(LEGACY)).toBeVisible();
    expect(await widgets(host)).toHaveLength(2);
  });

  test("closing a tab stops its widget and activates the neighbour; Alt+W closes the tab, and the panel once no widget tab is left (the tab's own close keeps the panel)", async ({ host }) => {
    await host.button("Close New test widget").click();
    await expect(host.tab(/New test widget/)).toHaveCount(0);
    await expect(host.tab(/Legacy test widget/)).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => widgets(host)).toEqual([LEGACY]);
    await expect(host.iframe(NEW)).toHaveCount(0);
    // The tooltips name Alt+W where it applies: the active tab.
    await expect(host.button("Close panel")).toHaveAttribute("title", "Close panel");
    await expect(host.button("Close Legacy test widget")).toHaveAttribute("title", "Close Legacy test widget (Alt+W)");
    await expect(host.button("Close Room overview")).toHaveAttribute("title", "Close Room overview");

    // Held down, Alt+W closes one tab: the repeated keydown (autoRepeat) would close the panel, which now has no widget tab.
    await host.page.keyboard.down("Alt");
    await host.page.keyboard.down("KeyW");
    await host.page.keyboard.down("KeyW");
    await host.page.keyboard.up("KeyW");
    await host.page.keyboard.up("Alt");
    await expect(host.tab(/Legacy test widget/)).toHaveCount(0);
    await expect(host.tab("Room overview")).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => widgets(host)).toEqual([]);
    await expect(host.panels).toHaveCount(1);

    // Only a native tab is left: Alt+W would close the panel; the tab's own close (here a middle click) closes the tab only.
    await expect(host.button("Close panel")).toHaveAttribute("title", "Close panel (Alt+W)");
    await expect(host.button("Close Room overview")).toHaveAttribute("title", "Close Room overview");
    await host.tab("Room overview").click({ button: "middle" });
    await expect(host.page.getByRole("tab")).toHaveCount(0);
    await expect(host.page.getByTestId("widget-tiles")).toBeVisible();
    await expect(host.panels).toHaveCount(1);

    // The room header opens the overview again; Alt+W closes the panel, the overview tab with it.
    await host.page.getByTitle("Widget lab · open the room overview").click();
    await expect(host.tab("Room overview")).toHaveAttribute("aria-selected", "true");
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

  test("arrow keys move the focus between the tabs, Enter activates, Delete closes", async ({ host }) => {
    await host.tab(/New test widget/).focus();
    await host.page.keyboard.press("ArrowRight");
    await expect(host.tab(/Legacy test widget/)).toBeFocused();
    // Manual activation: the focused tab is not the selected one yet.
    await expect(host.tab(/New test widget/)).toHaveAttribute("aria-selected", "true");
    await host.page.keyboard.press("Enter");
    await expect(host.tab(/Legacy test widget/)).toHaveAttribute("aria-selected", "true");

    await host.page.keyboard.press("End");
    await expect(host.tab("Room overview")).toBeFocused();
    await host.page.keyboard.press("ArrowRight"); // wraps around
    await expect(host.tab(/New test widget/)).toBeFocused();
    await host.page.keyboard.press("ArrowLeft");
    await expect(host.tab("Room overview")).toBeFocused();

    await host.page.keyboard.press("Delete");
    await expect(host.tab("Room overview")).toHaveCount(0);
  });
});

test("a widget picked in a new tab takes the place of that tab", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET] }] });
  await host.button("New tab").click();
  await host.page.getByTestId("widget-tiles").getByRole("button", { name: "Open Legacy test widget" }).click();
  await expect(host.page.getByRole("tab")).toHaveText([/New test widget/, /Legacy test widget/]);
  await expect(host.tab(/Legacy test widget/)).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => widgets(host)).toEqual([NEW, LEGACY]);
});

test("the dev tools button of a tab only exists while dev tools are enabled", async ({ host }) => {
  // A seed can turn the dev tools off, also in the DevBackend.
  await host.populate("lab", { sidePanel: null, settings: { devTools: false }, open: [{ room: LAB, widgets: [NEW_WIDGET] }] });
  await expect(host.tab(/New test widget/)).toBeVisible();
  await expect(host.button("Dev tools of New test widget")).toHaveCount(0);
  await expect(host.button("Close New test widget")).toHaveCount(1);

  // The settings intent cannot: while the DevBackend is active it forces them on.
  await host.dispatch({ type: "settings/set", settings: { devTools: false } });
  await expect(host.button("Dev tools of New test widget")).toHaveCount(1);
  expect((await host.state()).settings.devTools).toBe(true);

  await host.button("Dev tools of New test widget").click();
  await expect(host.button("Dev tools of New test widget")).toHaveAttribute("aria-pressed", "true");
});

test("more tabs than fit: the bar scrolls and the “All tabs” menu lists and activates them", async ({ host }) => {
  const keys = Array.from({ length: 8 }, (_, i) => `m.widget/w${i + 1}`);
  await host.populate("many-widgets", { sidePanel: null, behavior: { autoApproveCapabilities: true }, open: [{ room: MANY, widgets: keys, overview: true, active: keys[2] }] });
  await host.page.setViewportSize({ width: 1000, height: 800 }); // still wide (not the narrow layout), but too small for nine tabs
  const panel = host.panels.first();
  await expect(panel.getByRole("tab")).toHaveCount(9);

  const all = panel.getByRole("button", { name: /^All \d+ tabs$/ });
  await expect(all).toHaveAccessibleName("All 9 tabs");
  await expect(panel.getByTestId("tab-bar")).toHaveClass(/overflowing/);
  // The active tab is scrolled into view, the last one is not.
  await expect(panel.getByRole("tab", { name: /Quick poll/ })).toBeInViewport();
  await expect(panel.getByRole("tab", { name: "Room overview" })).not.toBeInViewport();

  await all.click();
  const menu = host.page.getByRole("menu", { name: "All tabs of Design crit" });
  await expect(menu.getByRole("menuitemradio")).toHaveCount(9);
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
