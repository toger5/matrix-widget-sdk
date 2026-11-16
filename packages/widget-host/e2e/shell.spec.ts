/** The app shell: the LeftBar (Dev tools button, collapse, fullscreen), the modals, the narrow window and the login page. */
import { expect, Host, LAB, LEGACY_WIDGET, NEW_WIDGET, test, widgetId } from "./host";

const NEW = widgetId(LAB, NEW_WIDGET);
const STANDUP = "!standup:dev.local";
const TWO_PANELS = [{ room: LAB }, { room: STANDUP }];

test.describe("LeftBar while the DevBackend is active", () => {
  test.beforeEach(async ({ host }) => {
    await host.populate("lab", { open: [{ room: LAB, widgets: [NEW_WIDGET] }] });
  });

  test("the DevBackend is signalled by the fence, the badge and the account icon", async ({ host }) => {
    await expect(host.app).toHaveClass(/fence/);
    await expect(host.leftBar.getByText("DevBackend", { exact: true })).toBeVisible();
    await expect(host.button("Account: DevBackend")).toBeVisible();
    await expect(host.leftBar.getByRole("button", { name: "Dev tools", exact: true })).toHaveAttribute("aria-pressed", "true");
    await host.leaf("leftbar/devbackend");

    await host.button("Dev tools of New test widget").click();
    await expect(host.page.getByTestId("widget-dev-tools")).toBeVisible();
    await host.leaf("app/devbackend");
  });

  test("the Dev tools button only opens and closes the Dev tools: it never leaves the DevBackend", async ({ host }) => {
    const button = host.leftBar.getByRole("button", { name: "Dev tools", exact: true });
    await button.hover();
    await expect(host.leftBar.locator(".tooltip")).toBeVisible();
    await expect(host.leftBar.locator(".tooltip")).toHaveText("Dev tools");
    await host.leaf("leftbar/devbackend-hover");

    await button.click();
    await expect(host.sidePanel).toHaveCount(0);
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect(host.app).toHaveClass(/fence/);
    await expect(host.tab(/New test widget/)).toBeVisible();
    expect((await host.main()).modal).toBeUndefined();

    await button.click();
    await expect(host.page.getByTestId("devbackend-view")).toBeVisible();
    // "Leave DevBackend" needs a Matrix account to go back to: after a skipped login there is none.
    await expect(host.button("Leave DevBackend")).toHaveCount(0);
  });

  test("the + button and Alt+N open a new room panel, Alt+W closes it unless a text field has the focus", async ({ host }) => {
    await host.button(/^New room panel/).click();
    await expect(host.panels).toHaveCount(2);
    await host.page.keyboard.press("Alt+KeyN");
    await expect(host.panels).toHaveCount(3);

    // The new picker panel is focused and has no widget tab: Alt+W closes it, but not while typing in its search field.
    const picker = host.page.locator('[data-testid="room-panel"][data-focused="true"]');
    await expect(picker).toHaveAccessibleName("Room panel: choose a room");
    await expect(picker.getByRole("button", { name: "Close panel" })).toHaveAttribute("title", "Close panel (Alt+W)");
    const search = picker.getByRole("searchbox", { name: "Search rooms" });
    await search.click();
    await host.page.keyboard.press("Alt+KeyW");
    await expect(host.panels).toHaveCount(3);
    await expect(search).toBeFocused();
    await search.blur();
    // AltGr arrives as Ctrl+Alt on Windows: not the shortcut.
    await host.page.keyboard.press("Control+Alt+KeyW");
    await expect(host.panels).toHaveCount(3);
    await host.page.keyboard.press("Alt+KeyW");
    await expect(host.panels).toHaveCount(2);
  });
});

test.describe("collapsing the LeftBar", () => {
  test("collapse → toast → Escape reveals the expand button → the bar is back", async ({ host }) => {
    await host.populate("two-rooms", { sidePanel: null, open: TWO_PANELS });
    await host.button("Collapse the bar").click();
    await expect(host.leftBar).toHaveCount(0);
    await expect(host.toast).toHaveText(/Press Esc to show the expand button/);
    await expect(host.button("Show the left bar")).toHaveCount(0);
    await host.leaf("leftbar/collapsed-toast");

    // Without the LeftBar its badge is gone: a floating one takes over.
    await host.toast.getByRole("button", { name: "Dismiss" }).click();
    await expect(host.toast).toHaveCount(0);
    await expect(host.app.locator(".dev-badge")).toBeVisible();
    await expect(host.app).not.toHaveClass(/fullscreen/);
    await host.leaf("app/devbackend-collapsed");

    await host.page.keyboard.press("Escape");
    await expect(host.button("Show the left bar")).toBeVisible();
    await host.leaf("leftbar/collapsed-expand");

    await host.button("Show the left bar").click();
    await expect(host.leftBar).toBeVisible();
    await expect(host.button("Show the left bar")).toHaveCount(0);
    await expect(host.app.locator(".dev-badge")).toHaveCount(0);
  });

  test("the mouse at the left screen edge reveals the expand button too", async ({ host }) => {
    await host.populate("two-rooms", { sidePanel: null, open: TWO_PANELS, leftBarCollapsed: true });
    await host.page.mouse.move(300, 400);
    await expect(host.button("Show the left bar")).toHaveCount(0);
    await host.page.mouse.move(1, 400);
    await expect(host.button("Show the left bar")).toBeVisible();
  });

  test("with exactly one widget tab the widget is fullscreen; the header shows the tab while hovered", async ({ host }) => {
    await host.populate("lab", { sidePanel: null, behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET] }] });
    await host.ready(NEW);
    await expect(host.app).not.toHaveClass(/fullscreen/);
    const token = await host.token(NEW);

    await host.button("Collapse the bar").click();
    await host.toast.getByRole("button", { name: "Dismiss" }).click();
    await host.page.mouse.move(640, 500);
    await expect(host.app).toHaveClass(/fullscreen/);
    await expect(host.tab(/New test widget/)).toBeHidden();
    await expect(host.button("Open a widget")).toBeHidden();
    await expect(host.app.locator(".dev-badge")).toBeVisible();
    // No padding around the only panel: it fills the window.
    expect(await host.panels.boundingBox()).toEqual({ x: 0, y: 0, width: 1280, height: 800 });
    expect(await host.token(NEW)).toBe(token);
    await host.leaf("app/fullscreen");

    await host.page.locator(".rp-head").hover();
    await expect(host.tab(/New test widget/)).toBeVisible();
    await expect(host.button("Open a widget")).toBeVisible();
    await host.leaf("app/fullscreen-hover");

    // Selecting the room name (the + does that too) ends the fullscreen view.
    await host.button("Open a widget").click();
    await expect(host.app).not.toHaveClass(/fullscreen/);
    await expect(host.tab(/New test widget/)).toBeVisible();
  });

  test("two widget tabs are not fullscreen", async ({ host }) => {
    await host.populate("lab", { sidePanel: null, leftBarCollapsed: true, open: [{ room: LAB, widgets: [NEW_WIDGET, LEGACY_WIDGET] }] });
    await expect(host.tab(/Legacy test widget/)).toBeVisible();
    await expect(host.app).not.toHaveClass(/fullscreen/);
    await host.tab(/Legacy test widget/).hover();
    await host.button("Close Legacy test widget").click();
    await expect(host.app).toHaveClass(/fullscreen/);
  });
});

test.describe("modals", () => {
  test("the app info modal closes with Escape, with its button and with a press next to it", async ({ host }) => {
    await host.populate("lab", { sidePanel: null, open: [{ room: LAB }] });
    const dialog = host.page.getByRole("dialog", { name: "Widget Host" });

    await host.button("About this app").click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Got it" })).toBeFocused();
    await host.leaf("app/info-modal");

    // The shortcuts of the app are off while a modal is open.
    await host.page.keyboard.press("Alt+KeyN");
    await expect(host.panels).toHaveCount(1);
    await host.page.keyboard.press("Alt+KeyW"); // the panel has no widget tab: Alt+W would close it
    await expect(host.panels).toHaveCount(1);

    await host.page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(host.button("About this app")).toBeFocused();

    await host.button("About this app").click();
    await dialog.getByRole("button", { name: "Got it" }).click();
    await expect(dialog).toHaveCount(0);

    await host.button("About this app").click();
    await host.page.mouse.click(20, 780);
    await expect(dialog).toHaveCount(0);
  });

  test("stopping an always-on-screen widget is confirmed", async ({ host }) => {
    await host.populate("lab", { sidePanel: null, behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET, LEGACY_WIDGET], active: NEW_WIDGET }] });
    await host.ready(NEW);
    await host.frame(NEW).getByRole("button", { name: "set_always_on_screen true" }).click();
    await expect(host.tab(/New test widget/).locator(".ico")).not.toHaveCount(0);
    await host.tab(/Legacy test widget/).click();
    const confirm = host.page.getByRole("alertdialog");
    const stop = async () => {
      // The buttons of the PiP panel appear with its surround: on keyboard focus.
      await host.pip.focus();
      await host.page.keyboard.press("Tab");
      await host.pip.getByRole("button", { name: "Stop New test widget" }).click();
      await expect(confirm).toBeVisible();
    };

    await stop();
    await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await host.leaf("app/confirm");

    // It needs an answer: a press next to it does not close it. Escape and "Cancel" do, and the widget keeps running.
    await host.page.mouse.click(20, 780);
    await expect(confirm).toBeVisible();
    await host.page.keyboard.press("Escape");
    await expect(confirm).toHaveCount(0);
    await stop();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(host.pip.getByTestId("pip-box")).toHaveCount(1);

    await stop();
    await confirm.getByRole("button", { name: "Stop the widget" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(host.pip).toHaveCount(0);
    await expect(host.tab(/New test widget/)).toHaveCount(0);
    await expect(host.iframe(NEW)).toHaveCount(0);
  });
});

test("narrow window: the SidePanel overlays the RoomsArea, one room panel is shown and the pager steps through them", async ({ host }) => {
  await host.populate("two-rooms", { sidePanel: "account", open: TWO_PANELS });
  const pager = host.page.getByRole("group", { name: "Room panels" });
  await expect(host.panels).toHaveCount(2);
  await expect(pager).toHaveCount(0);
  const shifted = (await host.roomsArea.boundingBox())!.x;

  await host.page.setViewportSize({ width: 820, height: 800 });
  await expect(host.app).toHaveClass(/narrow/);
  await expect(host.panels.filter({ visible: true })).toHaveCount(1);
  await expect(pager).toHaveText(/Widget lab · 1 of 2/);
  await expect(host.page.getByRole("separator", { name: "Resize side panel" })).toHaveCount(0);
  // Overlay: the RoomsArea starts next to the LeftBar, below the SidePanel.
  const sideBox = (await host.sidePanel.boundingBox())!;
  const areaBox = (await host.roomsArea.boundingBox())!;
  expect(areaBox.x).toBeLessThan(shifted);
  expect(areaBox.x).toBeLessThan(sideBox.x + sideBox.width);
  await host.leaf("app/narrow");

  // A press next to the SidePanel closes it.
  await host.page.getByTestId("side-scrim").click({ position: { x: 700, y: 400 } });
  await expect(host.sidePanel).toHaveCount(0);

  await expect(pager.getByRole("button", { name: "Previous room panel" })).toBeDisabled();
  await pager.getByRole("button", { name: "Next room panel" }).click();
  await expect(pager).toHaveText(/Standup · 2 of 2/);
  await expect(host.panels.filter({ visible: true })).toHaveAccessibleName(/Standup/);
  await expect(pager.getByRole("button", { name: "Next room panel" })).toBeDisabled();

  await host.page.setViewportSize({ width: 1280, height: 800 });
  await expect(pager).toHaveCount(0);
  await expect(host.panels.filter({ visible: true })).toHaveCount(2);
});

test("a fresh browser without a stored login shows the login page; skipping it leads into the empty DevBackend", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const fresh = new Host(await context.newPage());
  await fresh.page.goto("/");
  await expect(fresh.page.getByTestId("login")).toBeVisible();
  await expect(fresh.page.getByRole("textbox", { name: "Homeserver" })).toHaveValue("matrix.org");
  await expect(fresh.button("Continue")).toBeEnabled();
  await fresh.leaf("app/login");

  await fresh.button(/Skip login and use the DevBackend/).click();
  await expect(fresh.app).toHaveClass(/fence/);
  await expect(fresh.page.getByTestId("devbackend-view")).toBeVisible();
  await expect(fresh.panels).toHaveCount(0);
  // Skipping the login enables the dev tools and the DevBackend, and there is no account to leave the DevBackend for.
  expect((await fresh.state()).settings).toMatchObject({ devTools: true, devBackend: true });
  await expect(fresh.button("Leave DevBackend")).toHaveCount(0);
  await fresh.leaf("app/devbackend-empty");
  await context.close();
});
