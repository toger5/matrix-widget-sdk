/** The SidePanel: opened by the LeftBar, shifts the RoomsArea, resizable; the SettingsView and the AccountView of the DevBackend; the complete views. */
import { expect, LAB, LEGACY_WIDGET, NEW_WIDGET, test, widgetId } from "./host";

const NEW = widgetId(LAB, NEW_WIDGET);
const STANDUP = "!standup:dev.local";

test.describe("SidePanel", () => {
  test.beforeEach(async ({ host }) => {
    await host.populate("two-rooms", { sidePanel: null, settings: { theme: "dark" }, open: [{ room: LAB }, { room: STANDUP }] });
  });

  test("the LeftBar buttons show one view at a time; pressing a button again or the close button closes the panel", async ({ host }) => {
    await expect(host.sidePanel).toHaveCount(0);
    await host.leaf("sidepanel/closed");

    await host.button("Settings").click();
    await expect(host.sidePanel).toHaveAttribute("data-view", "settings");
    await expect(host.button("Settings")).toHaveAttribute("aria-pressed", "true");

    await host.button("Account: DevBackend").click();
    await expect(host.sidePanel).toHaveAttribute("data-view", "account");
    await expect(host.button("Settings")).toHaveAttribute("aria-pressed", "false");
    await expect(host.button("Account: DevBackend")).toHaveAttribute("aria-pressed", "true");

    await host.button("DevBackend panel").click();
    await expect(host.sidePanel).toHaveAttribute("data-view", "devBackend");
    await expect(host.page.getByTestId("devbackend-view")).toBeVisible();

    await host.button("DevBackend panel").click();
    await expect(host.sidePanel).toHaveCount(0);

    await host.button("Settings").click();
    await host.sidePanel.getByRole("button", { name: "Close panel" }).click();
    await expect(host.sidePanel).toHaveCount(0);
    await expect(host.button("Settings")).toHaveAttribute("aria-pressed", "false");
  });

  test("the open panel shifts the RoomsArea and is resized with its handle", async ({ host }) => {
    const closed = (await host.roomsArea.boundingBox())!;
    await host.button("Settings").click();
    await expect(host.sidePanel).toBeVisible();
    const side = (await host.sidePanel.boundingBox())!;
    const shifted = (await host.roomsArea.boundingBox())!;
    expect(side.width).toBe(324);
    expect(shifted.x).toBeGreaterThanOrEqual(side.x + side.width);
    expect(shifted.x + shifted.width).toBe(closed.x + closed.width);
    await expect(host.panels.filter({ visible: true })).toHaveCount(2);
    await host.leaf("roomsarea/shifted");

    const handle = host.page.getByRole("separator", { name: "Resize side panel" });
    await handle.focus();
    await host.page.keyboard.press("ArrowRight");
    await expect(handle).toHaveAttribute("aria-valuenow", "340");
    await host.page.keyboard.press("Home");
    await expect(handle).toHaveAttribute("aria-valuenow", "260");
    await host.page.keyboard.press("End");
    await expect(handle).toHaveAttribute("aria-valuenow", "560");
    await host.page.keyboard.press("Enter");
    await expect(handle).toHaveAttribute("aria-valuenow", "324");

    const box = (await handle.boundingBox())!;
    await host.page.mouse.move(box.x + box.width / 2, 400);
    await host.page.mouse.down();
    await host.page.mouse.move(box.x + box.width / 2 + 100, 400, { steps: 3 });
    await host.page.mouse.up();
    await expect(handle).toHaveAttribute("aria-valuenow", "424");
    await expect.poll(async () => (await host.sidePanel.boundingBox())!.width).toBe(424);

    // The width is kept while the panel shows another view or is closed.
    await host.button("Settings").click();
    await host.button("Account: DevBackend").click();
    await expect.poll(async () => (await host.sidePanel.boundingBox())!.width).toBe(424);
    await handle.dblclick();
    await expect(handle).toHaveAttribute("aria-valuenow", "324");
  });

  test("settings: the dev tools are on and cannot be turned off while the DevBackend is active", async ({ host }) => {
    await host.button("Settings").click();
    const settings = host.page.getByTestId("settings-view");
    const toggle = settings.getByRole("switch", { name: "Enable dev tools" });
    await expect(toggle).toBeChecked();
    await expect(toggle).toBeDisabled();
    await expect(settings.getByText("Dev tools cannot be turned off while the DevBackend is active")).toBeVisible();
    await expect(settings.getByRole("listitem")).toHaveText([/DevBackend button in the left bar/, /Widget dev tools/, /Copy to DevBackend/]);
    await host.leaf("sidepanel/settings-on");

    // Not even by an intent: the DevBackend button stays.
    await host.dispatch({ type: "settings/set", settings: { devTools: false } });
    await expect(toggle).toBeChecked();
    await expect(host.button("DevBackend panel")).toBeVisible();
    expect((await host.state()).settings.devTools).toBe(true);
  });

  test("settings: the theme switch changes the theme of the app; System follows the browser", async ({ host }) => {
    const root = host.page.locator(".app-root");
    await host.button("Settings").click();
    const theme = host.page.getByRole("radiogroup", { name: "Theme" });
    await expect(theme.getByRole("radio", { name: "Dark" })).toBeChecked();
    await expect(root).toHaveAttribute("data-theme", "dark");
    const darkBackground = await host.sidePanel.locator(".sidebox").evaluate((e) => getComputedStyle(e).backgroundColor);

    await theme.getByRole("radio", { name: "Light" }).click();
    await expect(root).toHaveAttribute("data-theme", "light");
    await expect(theme.getByRole("radio", { name: "Light" })).toBeChecked();
    await expect(host.sidePanel.locator(".sidebox")).not.toHaveCSS("background-color", darkBackground);

    // The arrow keys move the selection: Light → Dark → System.
    await host.page.keyboard.press("ArrowRight");
    await expect(root).toHaveAttribute("data-theme", "dark");
    await host.page.keyboard.press("ArrowRight");
    await expect(theme.getByRole("radio", { name: "System" })).toBeChecked();
    await expect(theme.getByRole("radio", { name: "System" })).toBeFocused();
    await host.page.emulateMedia({ colorScheme: "light" });
    await expect(root).toHaveAttribute("data-theme", "light");
    await host.page.emulateMedia({ colorScheme: "dark" });
    await expect(root).toHaveAttribute("data-theme", "dark");
    await host.page.emulateMedia({ colorScheme: null });
  });

  test("account: the DevBackend is the account; adding a Matrix account shows the login form, which can be cancelled", async ({ host }) => {
    await host.button("Account: DevBackend").click();
    const account = host.page.getByTestId("account-view");
    await expect(account.getByText("@alice:dev.local")).toBeVisible();
    await expect(account.getByText("in-memory · no Matrix requests")).toBeVisible();
    await expect(account.getByText(/Add a Matrix account to leave it/)).toBeVisible();
    await expect(account.getByRole("button", { name: "Log out" })).toHaveCount(0);
    await expect(account.getByRole("button", { name: /^Switch to/ })).toHaveCount(0);
    await host.leaf("sidepanel/account-dev");

    await account.getByRole("button", { name: "Add account" }).click();
    const login = host.page.getByTestId("add-account");
    await expect(login.getByRole("textbox", { name: "Homeserver" })).toBeFocused();
    await expect(login.getByRole("button", { name: /Skip login/ })).toHaveCount(0);
    await expect(host.app).toHaveAttribute("inert", "");

    await login.getByRole("button", { name: "Cancel" }).click();
    await expect(login).toHaveCount(0);
    await expect(account).toBeVisible();
    await expect(host.app).toHaveClass(/fence/);
  });
});

test("Room list: a pick opens in the panel showing the room, else in the focused picker, else in a new panel; an open widget is jumped to; a narrow window closes the list", async ({ host }) => {
  await host.populate("two-rooms", { sidePanel: "rooms", behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET] }] });
  await host.ready(NEW);
  const list = host.page.getByTestId("room-list-view");
  await expect(host.sidePanel).toHaveAttribute("data-view", "rooms");
  await expect(host.button("Room list")).toHaveAttribute("aria-pressed", "true");
  await expect(list.locator(".side-title")).toHaveText("Rooms2 rooms");
  await expect(list.getByRole("heading")).toHaveText(["Recent widgets", "Recent rooms", "All rooms 2"]);
  const jump = list.getByRole("button", { name: "Jump to the tab of New test widget in Widget lab" });
  await expect(jump).toContainText("open");
  await host.leaf("sidepanel/rooms");
  await host.leaf("sidepanel/rooms-app");

  // A room no panel shows: a new panel right of the focused one, on the RoomOverview. The list stays open (wide window).
  await list.locator(`button.row[data-room-id="${STANDUP}"]`).click();
  await expect(host.panels).toHaveCount(2);
  await expect(host.panels.nth(1)).toHaveAttribute("data-room-id", STANDUP);
  await expect(host.panels.nth(1)).toHaveAttribute("data-focused", "true");
  await expect(host.panels.nth(1).getByRole("tab", { name: "Standup", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(host.sidePanel).toHaveAttribute("data-view", "rooms");
  // The pick is the newest recent room.
  const recentRooms = list.getByRole("region", { name: "Recent rooms" }).getByRole("button");
  await expect.poll(() => recentRooms.evaluateAll((tiles) => tiles.map((t) => t.getAttribute("data-room-id")))).toEqual([STANDUP, LAB]);

  // A room a panel shows: that panel, on its room name; the widget keeps its tab.
  await list.getByRole("button", { name: "Open Widget lab", exact: true }).click();
  await expect(host.panels).toHaveCount(2);
  await expect(host.panels.first()).toHaveAttribute("data-focused", "true");
  await expect(host.panels.first().getByRole("tab", { name: "Widget lab", exact: true })).toHaveAttribute("aria-selected", "true");
  // An open widget: its tab.
  await jump.click();
  await expect(host.tab(/New test widget/)).toHaveAttribute("aria-selected", "true");
  expect(Object.keys((await host.main()).widgets)).toEqual([NEW]);

  // The focused panel is a picker: it becomes the room.
  await host.panels.nth(1).getByRole("button", { name: "Close panel" }).click();
  await host.leftBar.getByRole("button", { name: /New room panel/ }).click();
  await expect(host.panels.nth(1)).toHaveAccessibleName("Room panel: choose a room");
  await list.locator(`button.row[data-room-id="${STANDUP}"]`).click();
  await expect(host.panels).toHaveCount(2);
  await expect(host.panels.nth(1)).toHaveAttribute("data-room-id", STANDUP);

  // In a narrow window the SidePanel lies over the room panel: it closes after a pick.
  await host.page.setViewportSize({ width: 820, height: 800 });
  await expect(host.app).toHaveClass(/narrow/);
  await list.getByRole("button", { name: "Open Widget lab", exact: true }).click();
  await expect(host.sidePanel).toHaveCount(0);
  await expect(host.panels).toHaveAttribute("data-room-id", LAB);
});

test.describe("complete views", () => {
  // The size of the "complete" mockups.
  test.beforeEach(({ host }) => host.page.setViewportSize({ width: 1440, height: 900 }));

  test("workspace: two rooms, the AccountView, dev tools with two panels and a widget in the PiP panel", async ({ host }) => {
    await host.populate("two-rooms", {
      sidePanel: "account",
      settings: { theme: "dark" },
      behavior: { autoApproveCapabilities: true },
      open: [{ room: LAB, widgets: [NEW_WIDGET, LEGACY_WIDGET], active: NEW_WIDGET }, { room: STANDUP, widgets: ["notes"] }],
    });
    await host.ready(NEW);
    await host.frame(NEW).getByRole("button", { name: "set_always_on_screen true" }).click();
    await expect(host.tab(/New test widget/).locator(".ico")).not.toHaveCount(0);
    await host.tab(/Legacy test widget/).click();
    await expect(host.pip.getByTestId("pip-box")).toHaveCount(1);

    await host.button("Dev tools of Legacy test widget").click();
    const tools = host.page.getByRole("toolbar", { name: "Widget dev tools" });
    await tools.getByRole("button", { name: /^Stats/ }).click();
    await expect(tools.getByRole("button", { name: /^Messages/ })).toHaveAttribute("aria-pressed", "true");
    await expect(host.page.getByTestId("widget-dev-tools").locator("section[data-dev-panel]")).toHaveCount(2);
    await expect(host.page.getByTestId("account-view")).toBeVisible();
    await expect(host.panels).toHaveCount(2);
    await host.leaf("complete/workspace");
  });

  test("DevBackend: the DevBackendView with the media tool, dev tools docked to the right", async ({ host }) => {
    await host.populate("lab", { settings: { theme: "dark" }, behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET] }] });
    await host.ready(NEW);
    await host.button(/Media Backend Tool/).click();
    await expect(host.page.getByTestId("devbackend-media")).toBeVisible();

    await host.button("Dev tools of New test widget").click();
    const tools = host.page.getByRole("toolbar", { name: "Widget dev tools" });
    await tools.getByRole("radio", { name: "Dock to the right" }).click();
    await expect(host.page.getByTestId("widget-dev-tools")).toHaveClass(/dt-right/);
    await expect(tools).toHaveAttribute("aria-orientation", "vertical");
    await expect(host.app).toHaveClass(/fence/);
    await host.leaf("complete/devbackend");
  });

  test("light theme: the same screen in the other theme", async ({ host }) => {
    await host.populate("two-rooms", { sidePanel: "settings", settings: { theme: "light" }, open: [{ room: LAB, widgets: [NEW_WIDGET, LEGACY_WIDGET] }, { room: STANDUP, widgets: ["notes"] }] });
    await expect(host.page.locator(".app-root")).toHaveAttribute("data-theme", "light");
    await expect(host.page.getByRole("radio", { name: "Light" })).toBeChecked();
    await expect(host.tab(/Standup notes/)).toBeVisible();
    await host.leaf("complete/light");
    await host.dispatch({ type: "settings/set", settings: { theme: "system" } });
  });
});
