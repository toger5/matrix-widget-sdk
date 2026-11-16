/** The WidgetDevToolBar of a widget tab: the bar, its four panels, docking, resizing and reloading. leaves devtools/* */
import type { Locator } from "@playwright/test";

import type { WidgetDevToolsLayout } from "../src/appViewModel";
import { expect, type Host, LAB, LEGACY_WIDGET, NEW_WIDGET, test, widgetId } from "./host";

const NEW = widgetId(LAB, NEW_WIDGET);
const SEND_MESSAGE = "widget:org.matrix.mscXXXX.send_event.timeline:m.room.message";

const devTools = (host: Host): Locator => host.page.getByTestId("widget-dev-tools");
const bar = (host: Host): Locator => host.page.getByRole("toolbar", { name: "Widget dev tools" });
/** A panel toggle of the bar. Its name ends with a badge ("Messages, 8") once there is something to count. */
const toggle = (host: Host, panel: "Messages" | "Stats" | "Driver" | "Console"): Locator => bar(host).getByRole("button", { name: new RegExp(`^${panel}`) });
const dock = (host: Host, side: "left" | "top" | "bottom" | "right"): Locator => bar(host).getByRole("radio", { name: `Dock to the ${side}` });
/** The open panels, left to right (top to bottom when docked to a side). */
const openPanels = (host: Host) => devTools(host).locator("section[data-dev-panel]").evaluateAll((els) => els.map((el) => el.getAttribute("data-dev-panel")));
const layout = async (host: Host): Promise<WidgetDevToolsLayout> => Object.values((await host.main()).workspaces)[0].devTools[NEW];
const approved = (host: Host) => host.page.evaluate((i) => window.widgetHost!.driverSnapshot(i)?.approved ?? [], NEW);
const box = async (locator: Locator) => (await locator.boundingBox())!;

test.beforeEach(async ({ host }) => {
  await host.populate("lab", { sidePanel: null, behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET, LEGACY_WIDGET], active: NEW_WIDGET }] });
  await host.ready(NEW);
  await host.button("Dev tools of New test widget").click();
});

test("the ⋯ button of the tab opens the bar with the messages panel; the bar docks top, bottom, left and right", async ({ host }) => {
  await expect(bar(host)).toBeVisible();
  await expect(host.button("Dev tools of New test widget")).toHaveAttribute("aria-pressed", "true");
  await expect(bar(host).getByRole("img", { name: "Widget is ready" })).toBeVisible();
  await expect(host.page.getByTestId("devtools-messages")).toBeVisible();
  await expect(toggle(host, "Messages")).toHaveAttribute("aria-pressed", "true");
  expect(await openPanels(host)).toEqual(["messages"]);
  await host.leaf("devtools/one-panel");

  // Without a panel only the bar is left, above the widget.
  await toggle(host, "Messages").click();
  await expect(devTools(host).locator("section")).toHaveCount(0);
  await expect(dock(host, "top")).toBeChecked();
  expect((await box(bar(host))).y + (await box(bar(host))).height).toBeLessThanOrEqual((await box(host.iframe(NEW))).y);
  await host.leaf("devtools/bar-top");

  await dock(host, "bottom").click();
  await expect(dock(host, "bottom")).toBeChecked();
  await expect(bar(host)).toHaveAttribute("aria-orientation", "horizontal");
  expect((await box(bar(host))).y).toBeGreaterThanOrEqual((await box(host.iframe(NEW))).y + (await box(host.iframe(NEW))).height);
  await host.leaf("devtools/bar-bottom");

  await dock(host, "left").click();
  await expect(bar(host)).toHaveAttribute("aria-orientation", "vertical");
  expect((await box(bar(host))).x + (await box(bar(host))).width).toBeLessThanOrEqual((await box(host.iframe(NEW))).x);
  await host.leaf("devtools/bar-left");

  await dock(host, "right").click();
  await expect(dock(host, "right")).toBeChecked();
  expect((await box(bar(host))).x).toBeGreaterThanOrEqual((await box(host.iframe(NEW))).x + (await box(host.iframe(NEW))).width);
  await host.leaf("devtools/bar-right");

  await bar(host).getByRole("button", { name: "Close the dev tools" }).click();
  await expect(bar(host)).toHaveCount(0);
  await expect(host.button("Dev tools of New test widget")).toHaveAttribute("aria-pressed", "false");
  // Opening them again brings the layout back: docked right, and the messages panel because no panel was open.
  await host.button("Dev tools of New test widget").click();
  await expect(dock(host, "right")).toBeChecked();
  expect(await openPanels(host)).toEqual(["messages"]);
});

test("panels open next to each other; the fourth closes the oldest; docked to a side they stack", async ({ host }) => {
  await toggle(host, "Stats").click();
  await expect(host.page.getByTestId("devtools-stats")).toBeVisible();
  expect(await openPanels(host)).toEqual(["messages", "stats"]);
  const [messages, stats] = [devTools(host).getByRole("region", { name: "Messages" }), devTools(host).getByRole("region", { name: "Stats" })];
  expect((await box(stats)).x).toBeGreaterThanOrEqual((await box(messages)).x + (await box(messages)).width);
  expect((await box(stats)).y).toBe((await box(messages)).y);
  await host.leaf("devtools/two-panels");

  await toggle(host, "Driver").click();
  await expect(host.page.getByTestId("devtools-driver")).toBeVisible();
  expect(await openPanels(host)).toEqual(["messages", "stats", "driver"]);
  await host.leaf("devtools/three-panels");

  await toggle(host, "Console").click();
  await expect(host.page.getByTestId("devtools-console")).toBeVisible();
  await expect(host.page.getByTestId("devtools-messages")).toHaveCount(0);
  await expect(toggle(host, "Messages")).toHaveAttribute("aria-pressed", "false");
  expect(await openPanels(host)).toEqual(["stats", "driver", "console"]);
  await host.leaf("devtools/fourth-panel");

  // A panel closes with its own × too.
  await devTools(host).getByRole("button", { name: "Close Stats" }).click();
  await toggle(host, "Console").click();
  await toggle(host, "Messages").click();
  expect(await openPanels(host)).toEqual(["driver", "messages"]);
  await dock(host, "right").click();
  const [driver, list] = [devTools(host).getByRole("region", { name: "Driver" }), devTools(host).getByRole("region", { name: "Messages" })];
  await expect.poll(async () => (await box(list)).y).toBeGreaterThanOrEqual((await box(driver)).y + (await box(driver)).height);
  expect((await box(list)).x).toBe((await box(driver)).x);
  await host.leaf("devtools/side-panels");
});

test("messages panel: lists the actions, a row expands to its JSON, the filter filters, Clear empties", async ({ host }) => {
  const panel = devTools(host).getByRole("region", { name: "Messages" });
  const rows = panel.getByRole("listitem");
  const logged = (await host.page.evaluate((i) => window.widgetHost!.devTools(i)!.messages.length, NEW)) as number;
  expect(logged).toBeGreaterThan(3);
  await expect(rows).toHaveCount(logged);
  await expect(toggle(host, "Messages")).toHaveAccessibleName(`Messages, ${logged}`);

  // A new action is added at the top.
  await host.frame(NEW).getByRole("button", { name: "get_matrix_context" }).click();
  await expect(rows).toHaveCount(logged + 1);
  await expect(rows.first()).toContainText("get_matrix_context");
  await expect(rows.first().getByRole("img", { name: "from widget to host" })).toBeVisible();
  await expect(rows.first().getByRole("img", { name: /^responded after \d+ ms$/ })).toBeVisible();

  await panel.getByRole("searchbox", { name: "Filter messages by action" }).fill("notify_ready");
  await expect(rows).toHaveCount(1);
  await rows.getByRole("button", { expanded: false }).click();
  await expect(rows.getByRole("button", { expanded: true })).toBeVisible();
  await expect(rows).toContainText("Request · widget → host");
  await expect(rows).toContainText(/responded after \d+ ms/);
  await panel.getByRole("searchbox").fill("");
  await host.frame(NEW).getByRole("button", { name: "send m.room.message" }).click();
  await expect(rows.filter({ hasText: "send_event" }).first()).toBeVisible();
  await rows.filter({ hasText: "send_event" }).first().getByRole("button", { expanded: false }).click();
  await expect(rows.filter({ hasText: "send_event" }).first().locator("pre").first()).toContainText("hello from the new widget");
  await expect(rows.filter({ hasText: "send_event" }).first().locator("pre").last()).toContainText("event_id");
  await host.leaf("devtools/messages");

  // Only one direction.
  await panel.getByRole("button", { name: /from widget$/ }).click();
  await expect(rows.getByRole("img", { name: "from widget to host" })).toHaveCount(0);
  await expect(rows.first().getByRole("img", { name: "from host to widget" })).toBeVisible();
  await panel.getByRole("button", { name: /from widget$/ }).click();

  await panel.getByRole("searchbox").fill("no such action");
  await expect(panel).toContainText("No message matches the filter.");
  await panel.getByRole("searchbox").fill("");

  await panel.getByRole("button", { name: "Clear" }).click();
  await expect(rows).toHaveCount(0);
  await expect(panel).toContainText("No messages yet.");
  await expect(toggle(host, "Messages")).toHaveAccessibleName("Messages");
  // The log of the test hook is not the panel's: it keeps everything.
  expect(await host.actions(NEW, "fromWidget")).toContainEqual(expect.stringMatching(/\.notify_ready$/));
});

test("stats panel: the tiles count actions and events", async ({ host }) => {
  await toggle(host, "Messages").click();
  await toggle(host, "Stats").click();
  const stats = host.page.getByTestId("devtools-stats");
  const tile = (label: string) => stats.locator(".stat", { hasText: label }).locator("b");
  const data = () => host.page.evaluate((i) => window.widgetHost!.devTools(i)!.stats, NEW);

  const before = await data();
  await expect(tile("actions sent")).toHaveText(String(before.actionsFromWidget + before.actionsToWidget));
  await expect(stats.locator(".stat", { hasText: "actions sent" })).toContainText(`${before.actionsFromWidget} from widget · ${before.actionsToWidget} to widget`);
  await expect(stats.locator(".stat", { hasText: "run duration" })).toContainText("since notify_ready");
  await expect(tile("run duration")).toHaveText(/^\d+ s$/);
  await expect(tile("events sent from the widget")).toHaveText("0");
  const shared = before.eventsSharedWithWidget;
  await expect(tile("events shared with the widget")).toHaveText(String(shared));

  // One event sent: the widget's send_event, and the host forwards the event to the widget.
  await host.frame(NEW).getByRole("button", { name: "send m.room.message" }).click();
  await expect(tile("events sent from the widget")).toHaveText("1");
  await expect(tile("events shared with the widget")).toHaveText(String(shared + 1));
  await expect(tile("actions sent")).toHaveText(String(before.actionsFromWidget + before.actionsToWidget + 2));
  await expect(stats.getByRole("figure")).toHaveAccessibleName(/^Characters sent over the widget API/);
  await host.leaf("devtools/stats");
});

test("driver panel: mock host actions reach the widget", async ({ host }) => {
  await toggle(host, "Messages").click();
  await toggle(host, "Driver").click();
  const driver = host.page.getByTestId("devtools-driver");
  const log = host.frame(NEW).locator("#log");

  await driver.getByRole("radio", { name: "light" }).click();
  await driver.getByRole("button", { name: "Update theme" }).click();
  await expect.poll(() => host.actions(NEW, "toWidget")).toContainEqual(expect.stringMatching(/\.update_theme$/));
  await expect(log).toContainText(/update_theme .*light/);

  await driver.getByRole("textbox", { name: "Language to send" }).fill("fr");
  await driver.getByRole("button", { name: "Update language" }).click();
  await expect.poll(() => host.actions(NEW, "toWidget")).toContainEqual(expect.stringMatching(/\.update_language$/));
  await expect(log).toContainText("update_language fr");

  await driver.getByRole("radio", { name: "hidden" }).click();
  await driver.getByRole("button", { name: "Update visibility" }).click();
  await expect.poll(() => host.actions(NEW, "toWidget")).toContainEqual(expect.stringMatching(/\.update_visibility$/));
  await expect(log).toContainText("update_visibility false");
});

test("driver panel: revoke one capability and all (confirm modal), add a capability", async ({ host }) => {
  await toggle(host, "Messages").click();
  await toggle(host, "Driver").click();
  const driver = host.page.getByTestId("devtools-driver");
  const held = driver.getByRole("list", { name: "Approved capabilities" }).getByRole("listitem");
  const modal = host.page.getByRole("alertdialog");
  const all = (await approved(host)).length;
  await expect(held).toHaveCount(all);
  await expect(driver).toContainText(`Approved capabilities ${all}`);
  await host.leaf("devtools/driver");

  // Revoke one: cancelling keeps it.
  const row = driver.locator(`[data-capability="${SEND_MESSAGE}"]`);
  await row.getByRole("button", { name: "Revoke this capability" }).click();
  await expect(modal).toContainText("Revoke this capability of New test widget?");
  await modal.getByRole("button", { name: "Cancel" }).click();
  await expect(modal).toHaveCount(0);
  expect(await approved(host)).toContain(SEND_MESSAGE);

  await row.getByRole("button", { name: "Revoke this capability" }).click();
  await modal.getByRole("button", { name: "Revoke" }).click();
  await expect(held).toHaveCount(all - 1);
  expect(await approved(host)).not.toContain(SEND_MESSAGE);
  // The widget is told, and its next send fails.
  await expect(host.frame(NEW).locator("#log")).toContainText("update_capabilities");
  await host.frame(NEW).getByRole("button", { name: "send m.room.message" }).click();
  await expect(host.frame(NEW).locator("#log")).toContainText("send m.room.message failed");
  expect((await host.store(LAB)).timeline.map((e) => (e.content as { body?: string }).body)).not.toContain("hello from the new widget");

  await driver.getByRole("button", { name: "Revoke all" }).click();
  await expect(modal).toContainText("Revoke all capabilities of New test widget?");
  await modal.getByRole("button", { name: "Revoke" }).click();
  await expect(held).toHaveCount(0);
  await expect(driver).toContainText("The widget holds no capability that you approved.");
  expect(await approved(host)).toEqual([]);

  // "Add" pre-approves: the capability is granted without a prompt the next time the widget asks for it.
  await host.dispatch({ type: "mock/setBehavior", roomId: LAB, behavior: { autoApproveCapabilities: false } });
  await driver.getByRole("textbox", { name: "Add capability" }).fill(SEND_MESSAGE);
  await driver.getByRole("button", { name: "Add" }).click();
  await expect(driver.getByRole("list", { name: "Auto-approved capabilities" }).getByRole("listitem")).toHaveText(/send_event\.timeline:m\.room\.message/);
  await host.frame(NEW).locator("button", { hasText: "request_capabilities" }).dispatchEvent("click");
  const prompt = host.page.getByTestId("capability-prompt");
  // The prompt asks about the rest only; denying it still leaves the widget with the pre-approved capability.
  await expect(prompt.getByRole("checkbox")).toHaveCount(all - 1);
  await prompt.getByRole("button", { name: "Deny all" }).click();
  await expect.poll(() => approved(host)).toEqual([SEND_MESSAGE]);
  await expect(driver.getByRole("list", { name: "Denied capabilities" }).getByRole("listitem")).toHaveCount(all - 1);
  await host.frame(NEW).getByRole("button", { name: "send m.room.message" }).click();
  await expect.poll(async () => (await host.store(LAB)).timeline.map((e) => (e.content as { body?: string }).body)).toContain("hello from the new widget");
});

test("console panel: lists what the host logs about the widget; filter and Clear", async ({ host }) => {
  await toggle(host, "Messages").click();
  await toggle(host, "Console").click();
  const panel = devTools(host).getByRole("region", { name: "Console" });
  const console_ = panel.getByRole("log", { name: "Widget console" });
  await expect(console_).toContainText("No console output.");

  await host.dispatch({ type: "devTools/revokeCapabilities", widgetId: NEW, capabilities: [SEND_MESSAGE], confirmed: true });
  await expect(console_.locator(".cl", { hasText: "revoked 1 capability" })).toHaveCount(1);
  await host.leaf("devtools/console");

  await panel.getByRole("searchbox", { name: "Filter console lines" }).fill("no such line");
  await expect(console_).toContainText("No line matches the filter.");
  await panel.getByRole("searchbox").fill("revoked");
  await expect(console_.locator(".cl")).toHaveCount(1);
  await panel.getByRole("button", { name: "info" }).click();
  await expect(console_.locator(".cl")).toHaveCount(0);
  await panel.getByRole("button", { name: "info" }).click();
  await panel.getByRole("searchbox").fill("");

  await panel.getByRole("button", { name: "Clear" }).click();
  await expect(console_).toContainText("No console output.");
});

test("the dev tools are resized with the separator: keyboard and drag", async ({ host }) => {
  const separator = host.page.getByRole("separator", { name: "Resize the dev tools" });
  const panels = devTools(host).locator(".dt-panels");
  await expect(separator).toHaveAttribute("aria-valuenow", "240");
  expect((await box(panels)).height).toBe(240);

  await separator.focus();
  await host.page.keyboard.press("ArrowDown");
  await expect(separator).toHaveAttribute("aria-valuenow", "256");
  await host.page.keyboard.press("ArrowUp");
  await host.page.keyboard.press("ArrowUp");
  await expect(separator).toHaveAttribute("aria-valuenow", "224");
  expect((await layout(host)).size).toEqual({ top: 224, side: 360 });
  await expect.poll(async () => (await box(panels)).height).toBe(224);

  const at = await box(separator);
  await host.page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await host.page.mouse.down();
  await host.page.mouse.move(at.x + at.width / 2, at.y + at.height / 2 + 60, { steps: 3 });
  await host.page.mouse.up();
  await expect(separator).toHaveAttribute("aria-valuenow", "284");
  await expect.poll(async () => (await box(panels)).height).toBe(284);
  const token = await host.token(NEW);

  // Enter resets to the default size.
  await separator.press("Enter");
  await expect(separator).toHaveAttribute("aria-valuenow", "240");

  // Docked to a side the same separator changes the width, and keeps its own size.
  await dock(host, "left").click();
  await expect(separator).toHaveAttribute("aria-valuenow", "360");
  await separator.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", "376");
  expect((await layout(host)).size).toEqual({ top: 240, side: 376 });

  // Docked to the bottom it shares the height with the top dock. The bar is at the bottom edge and the
  // separator above the panels, so ArrowUp and dragging up make them larger.
  await dock(host, "bottom").click();
  await expect(separator).toHaveAttribute("aria-valuenow", "240");
  expect((await box(separator)).y + (await box(separator)).height).toBeLessThanOrEqual((await box(panels)).y);
  expect((await box(panels)).y + (await box(panels)).height).toBeLessThanOrEqual((await box(bar(host))).y);
  await separator.press("ArrowUp");
  await expect(separator).toHaveAttribute("aria-valuenow", "256");
  expect((await layout(host)).size).toEqual({ top: 256, side: 376 });
  const bottom = await box(separator);
  await host.page.mouse.move(bottom.x + bottom.width / 2, bottom.y + bottom.height / 2);
  await host.page.mouse.down();
  await host.page.mouse.move(bottom.x + bottom.width / 2, bottom.y + bottom.height / 2 - 40, { steps: 3 });
  await host.page.mouse.up();
  await expect(separator).toHaveAttribute("aria-valuenow", "296");
  await expect.poll(async () => (await box(panels)).height).toBe(296);
  await host.leaf("devtools/bottom-panel");
  expect(await host.token(NEW)).toBe(token);
});

test("two panels are resized against each other with the separator between them", async ({ host }) => {
  await toggle(host, "Stats").click();
  const split = host.page.getByRole("separator", { name: "Resize the dev tool panels Messages and Stats" });
  const messages = devTools(host).getByRole("region", { name: "Messages" });
  await expect(split).toHaveAttribute("aria-valuenow", "50");
  const width = (await box(messages)).width;

  await split.press("ArrowRight");
  await expect(split).toHaveAttribute("aria-valuetext", "Messages 55 %");
  await expect.poll(async () => (await box(messages)).width).toBeGreaterThan(width);

  const at = await box(split);
  await host.page.mouse.move(at.x + at.width / 2, at.y + 40);
  await host.page.mouse.down();
  await host.page.mouse.move(at.x + at.width / 2 - 200, at.y + 40, { steps: 3 });
  await host.page.mouse.up();
  await expect.poll(async () => (await box(messages)).width).toBeLessThan(width - 100);
  const shares = (await layout(host)).panels.map((p) => p.share);
  expect(shares[0]).toBeLessThan(shares[1]);

  await split.dblclick();
  await expect(split).toHaveAttribute("aria-valuenow", "50");
});

test("the dev tools layout survives moving the widget into the PiP panel and back", async ({ host }) => {
  await toggle(host, "Driver").click();
  await dock(host, "left").click();
  const before = await layout(host);
  expect(before).toMatchObject({ open: true, dock: "left", panels: [{ panel: "messages" }, { panel: "driver" }] });
  const token = await host.token(NEW);

  await host.frame(NEW).getByRole("button", { name: "set_always_on_screen true" }).click();
  await expect.poll(async () => (await host.main()).widgets[NEW].alwaysOnScreen).toBe(true);
  await host.tab(/Legacy test widget/).click();
  const pipBox = host.pip.getByTestId("pip-box");
  await expect(pipBox.getByRole("toolbar", { name: "Widget dev tools" })).toHaveAttribute("aria-orientation", "vertical");
  expect(await openPanels(host)).toEqual(["messages", "driver"]);
  expect(await layout(host)).toEqual(before);
  expect(await host.token(NEW)).toBe(token);

  await host.tab(/New test widget/).click();
  await expect(host.pip).toHaveCount(0);
  await expect(dock(host, "left")).toBeChecked();
  expect(await openPanels(host)).toEqual(["messages", "driver"]);
  expect(await layout(host)).toEqual(before);
  expect(await host.token(NEW)).toBe(token);
});

test("the reload button starts the widget again: new iframe and driver, the log starts empty, the layout stays", async ({ host }) => {
  await toggle(host, "Driver").click();
  await dock(host, "bottom").click();
  const before = await layout(host);
  const token = await host.token(NEW);
  const generation = (await host.main()).widgets[NEW].generation!;
  expect(await approved(host)).toContain(SEND_MESSAGE);
  const pressedAt = await host.page.evaluate(() => Date.now());

  // By keyboard: the reload button sits between the panel toggles and the dock group of the toolbar.
  const reload = bar(host).getByRole("button", { name: "Reload the widget" });
  await toggle(host, "Messages").focus();
  await host.page.keyboard.press("End");
  await expect(bar(host).getByRole("button", { name: "Close the dev tools" })).toBeFocused();
  for (let i = 0; i < 5; i++) await host.page.keyboard.press("ArrowLeft");
  await expect(reload).toBeFocused();
  await expect(reload).toHaveAttribute("tabindex", "0");
  await host.page.keyboard.press("Enter");
  await expect.poll(async () => (await host.main()).widgets[NEW].generation).toBeGreaterThan(generation);
  await expect(reload).toBeFocused();
  await host.ready(NEW);
  await expect(bar(host).getByRole("img", { name: "Widget is ready" })).toBeVisible();
  expect(await host.token(NEW)).not.toBe(token);
  expect(await layout(host)).toEqual(before);

  // The new driver negotiates the capabilities again (auto-approved by the seed's behavior), and the
  // message log only holds what happened since the reload.
  await expect.poll(() => approved(host)).toContain(SEND_MESSAGE);
  const timestamps = await host.page.evaluate((i) => window.widgetHost!.devTools(i)!.messages.map((m) => m.timestamp), NEW);
  expect(timestamps.length).toBeGreaterThan(0);
  expect(Math.min(...timestamps)).toBeGreaterThanOrEqual(pressedAt);
});

test("a reload decides nothing for the user: an open prompt and denied capabilities are asked again", async ({ host }) => {
  // Without auto-approval and without remembering (the DevBackend's default behavior).
  await host.populate("lab", { sidePanel: null, open: [{ room: LAB, widgets: [NEW_WIDGET], active: NEW_WIDGET }] });
  const prompt = host.page.getByTestId("capability-prompt");
  await expect(prompt).toBeVisible();
  await host.button("Dev tools of New test widget").click();
  const reload = async () => {
    const generation = (await host.main()).widgets[NEW].generation!;
    await bar(host).getByRole("button", { name: "Reload the widget" }).click();
    await expect.poll(async () => (await host.main()).widgets[NEW].generation).toBeGreaterThan(generation);
  };

  // Reloaded while the prompt is open: the new driver asks again, nothing is granted meanwhile.
  await reload();
  await expect.poll(() => host.actions(NEW, "fromWidget")).toContainEqual(expect.stringMatching(/\.request_capabilities$/));
  await expect(prompt).toBeVisible();
  expect(await approved(host)).toEqual([]);

  await prompt.getByRole("button", { name: "Deny all" }).click();
  await host.ready(NEW);
  expect(await approved(host)).toEqual([]);

  // What was denied (and not remembered) is not granted by the restart: the user is asked again.
  await reload();
  await expect.poll(() => host.actions(NEW, "fromWidget")).toContainEqual(expect.stringMatching(/\.request_capabilities$/));
  await expect(prompt).toBeVisible();
  expect(await approved(host)).toEqual([]);
});

test("a reload loads the current URL of the widget's state event", async ({ host }) => {
  const url = "http://localhost:5175/new/?changed=1";
  await host.dispatch({ type: "mock/sendState", roomId: LAB, event: { type: "m.widget", stateKey: "widget-1", content: { name: "New test widget", url, uses_widget_api: true } } });
  const eventUrl = async () => {
    const rooms = (await host.main()).data.rooms;
    const event = rooms.status === "ready" ? rooms.value.find((r) => r.id === LAB)?.widgetEvents?.find((e) => e.type === "m.widget") : undefined;
    return event?.content.url;
  };
  await expect.poll(eventUrl).toBe(url);
  // The running widget keeps its URL (finding widget-url-changes-while-running) until it is reloaded.
  await expect(host.iframe(NEW)).toHaveAttribute("src", "http://localhost:5175/new/");

  await bar(host).getByRole("button", { name: "Reload the widget" }).click();
  await expect(host.iframe(NEW)).toHaveAttribute("src", url);
  await host.ready(NEW);
});
