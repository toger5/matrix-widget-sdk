/**
 * Webview capabilities: the iframe of a widget starts strict, a granted `webview:` capability applies
 * with a restart of the widget (a new generation), a legacy widget gets a legacy client's iframe, and
 * no widget runs on the host's own origin. The prompt lists them under "Browser permissions"; the
 * driver panel shows the iframe's attributes ("Webview of this load").
 * stories `widget-widgetview--capability-prompt-webview`, `widget-devtools--driver-webview`
 */
import type { Locator } from "@playwright/test";

import type { HostSeed } from "../src/app/controller";
import { capabilityBoxes, expect, Host, LAB, LEGACY_WIDGET, NEW_WIDGET, test, widgetId } from "./host";

const NEW = widgetId(LAB, NEW_WIDGET);
const LEGACY = widgetId(LAB, LEGACY_WIDGET);
const CAMERA = "webview:org.matrix.mscXXXX.allow:camera";
const MICROPHONE = "webview:org.matrix.mscXXXX.allow:microphone";
const TOP_NAVIGATION = "webview:org.matrix.mscXXXX.sandbox:allow-top-navigation";
const STRICT_SANDBOX = "allow-scripts allow-same-origin";
/** A widget that says nothing until its buttons are pressed. */
const QUIET = "http://localhost:5175/new/?autostart=0";

/** A room with one widget at `url`, open in a tab. */
const oneWidget = (url: string, extra: Partial<HostSeed> = {}): HostSeed => ({
  userId: "@alice:dev.local",
  rooms: [{ id: LAB, name: "Widget lab", widgets: [{ type: "m.widget", state_key: "widget-1", content: { name: "New test widget", url, uses_widget_api: true } }] }],
  sidePanel: null,
  open: [{ room: LAB, widgets: [NEW_WIDGET] }],
  ...extra,
});

/** A button of the test widget, pressed with a DOM click: the widget may be hidden (loading) or covered by the prompt. */
const press = (host: Host, id: string, label: string) => host.frame(id).locator("button", { hasText: label }).first().dispatchEvent("click");
const requestNext = (host: Host, id: string, capabilities: string[]) => host.frame(id).locator("#caps").evaluate((input: HTMLInputElement, value) => (input.value = value), capabilities.join(","));
/** The newest line of the test widget's log. */
const lastLog = (host: Host, id: string): Locator => host.frame(id).locator("#log pre").first();
const webview = (host: Host, id: string) => host.page.evaluate((i) => window.widgetHost!.webview(i), id);
const generation = async (host: Host, id: string) => (await webview(host, id))?.generation;
const approved = (host: Host, id: string) => host.page.evaluate((i) => window.widgetHost!.driverSnapshot(i)?.approved ?? [], id);
const prompt = (host: Host) => host.page.getByTestId("capability-prompt");
const browserPermissions = (host: Host) => prompt(host).getByRole("group", { name: "Browser permissions" });

/** Start the quiet widget and make it ready. */
async function readyQuietWidget(host: Host, extra: Partial<HostSeed> = {}): Promise<void> {
  await host.populate(oneWidget(QUIET, extra));
  await press(host, NEW, "notify_ready");
  await host.ready(NEW);
}

/** Ask for camera and microphone: the prompt lists both under "Browser permissions", checked. */
async function askCameraAndMicrophone(host: Host): Promise<void> {
  await press(host, NEW, "webview: request camera + microphone");
  await expect(capabilityBoxes(prompt(host))).toHaveCount(2);
  await expect(browserPermissions(host).getByRole("checkbox", { name: `Use your camera (${CAMERA})` })).toBeChecked();
  await expect(browserPermissions(host).getByRole("checkbox", { name: `Use your microphone (${MICROPHONE})` })).toBeChecked();
}

/** Ask for camera and microphone and approve both: the widget starts again. Returns the generation before. */
async function grantCameraAndMicrophone(host: Host, mark?: (host: Host) => Promise<void>): Promise<number> {
  const before = (await generation(host, NEW))!;
  await askCameraAndMicrophone(host);
  await mark?.(host);
  await host.passApproveDelay();
  await prompt(host).getByRole("button", { name: "Approve 2 selected" }).click();
  await expect.poll(() => generation(host, NEW)).toBe(before + 1);
  return before;
}

test.beforeEach(async ({ host }) => {
  // What "remember capabilities" stored in an earlier run.
  await host.page.evaluate(() => localStorage.clear());
});

test("a widget's iframe starts strict: scripts and its own origin, no browser feature, no popup", async ({ host }) => {
  await readyQuietWidget(host);
  await expect(host.iframe(NEW)).toHaveAttribute("sandbox", STRICT_SANDBOX);
  await expect(host.iframe(NEW)).toHaveAttribute("allow", "");
  expect(await webview(host, NEW)).toMatchObject({ sandbox: STRICT_SANDBOX, allow: "", applied: [] });
  await press(host, NEW, "webview: feature policy");
  await expect(lastLog(host, NEW)).toContainText('"camera":false');
  await press(host, NEW, "webview: open popup");
  await expect(lastLog(host, NEW)).toContainText('"popup":"blocked"');
});

test("an approved webview capability restarts the widget with it; asking again needs no prompt and no restart", async ({ host }) => {
  await readyQuietWidget(host);
  const before = await grantCameraAndMicrophone(host, async () => {
    // Risky, so first and bold in the summary; the note says what approving does.
    await expect(prompt(host).locator(".pc-sum b")).toHaveText("use your camera, microphone or screen");
    await expect(prompt(host)).toContainText("New test widget wants to use your camera, microphone or screen.");
    await expect(browserPermissions(host)).toContainText("Approving these restarts the widget. Your browser may still ask before it uses the camera or microphone.");
    await expect(browserPermissions(host).getByRole("img", { name: "Can see you" })).toBeVisible();
    await expect(browserPermissions(host).getByRole("img", { name: "Can hear you" })).toBeVisible();
    await expect(prompt(host).getByRole("group", { name: "Unknown to this app" })).toHaveCount(0);
    await host.story("widget-widgetview--capability-prompt-webview");
  });
  await expect(host.iframe(NEW)).toHaveAttribute("allow", "camera 'src'; microphone 'src'");
  await expect(host.iframe(NEW)).toHaveAttribute("sandbox", STRICT_SANDBOX);
  expect((await webview(host, NEW))?.applied).toEqual([CAMERA, MICROPHONE]);

  // The new start may use the camera.
  await press(host, NEW, "notify_ready");
  await host.ready(NEW);
  await press(host, NEW, "webview: feature policy");
  await expect(lastLog(host, NEW)).toContainText('"camera":true,"microphone":true');

  // Its request is granted at once.
  await press(host, NEW, "webview: request camera + microphone");
  await expect.poll(() => approved(host, NEW)).toEqual([CAMERA, MICROPHONE]);
  await expect(prompt(host)).toHaveCount(0);
  expect(await generation(host, NEW)).toBe(before + 1);
});

test("a denied webview capability changes nothing: no restart", async ({ host }) => {
  await readyQuietWidget(host);
  const before = await generation(host, NEW);
  await askCameraAndMicrophone(host);
  await prompt(host).getByRole("button", { name: "Deny all" }).click();
  await expect(prompt(host)).toHaveCount(0);
  await expect.poll(() => host.actions(NEW, "toWidget")).toContainEqual(expect.stringMatching(/\.update_capabilities$/));
  expect(await generation(host, NEW)).toBe(before);
  await expect(host.iframe(NEW)).toHaveAttribute("allow", "");
});

test("revoking a webview capability restarts the widget without it", async ({ host }) => {
  await readyQuietWidget(host);
  const before = await grantCameraAndMicrophone(host);
  await host.dispatch({ type: "devTools/revokeCapabilities", widgetId: NEW, capabilities: [CAMERA], confirmed: true });
  await expect.poll(() => generation(host, NEW)).toBe(before + 2);
  await expect(host.iframe(NEW)).toHaveAttribute("allow", "microphone 'src'");
  expect((await webview(host, NEW))?.applied).toEqual([MICROPHONE]);
});

test("a remembered webview capability is in the iframe from the start, before any prompt", async ({ host }) => {
  await host.page.evaluate(([key, value]) => localStorage.setItem(key, value), ["widget_host_capabilities_v2 @alice:dev.local !lab:dev.local m.widget/widget-1", JSON.stringify([CAMERA])]);
  await host.populate(oneWidget(QUIET, { behavior: { rememberCapabilities: true } }));
  await expect(host.iframe(NEW)).toHaveAttribute("allow", "camera 'src'");
  const first = await generation(host, NEW);
  await press(host, NEW, "notify_ready");
  await host.ready(NEW);
  await requestNext(host, NEW, [CAMERA]);
  await press(host, NEW, "request_capabilities");
  await expect.poll(() => approved(host, NEW)).toEqual([CAMERA]);
  await expect(prompt(host)).toHaveCount(0);
  expect(await generation(host, NEW)).toBe(first);
});

test("a legacy widget gets a legacy client's iframe, outside and inside the compat wrapper, without a prompt or a restart", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, open: [{ room: LAB, widgets: [LEGACY_WIDGET] }] });
  // The wrapper's request for them was granted at once: the prompt holds the legacy widget's own capabilities only.
  await expect(prompt(host)).toContainText("Legacy test widget asks for permissions");
  await expect(prompt(host).getByRole("checkbox", { name: /webview:/ })).toHaveCount(0);
  expect(await approved(host, LEGACY)).toContain(CAMERA);
  const first = await generation(host, LEGACY);
  const count = await capabilityBoxes(prompt(host)).count();
  await host.passApproveDelay();
  await prompt(host).getByRole("button", { name: `Approve ${count} selected` }).click();
  await host.ready(LEGACY);
  expect(await generation(host, LEGACY)).toBe(first);

  const outer = host.iframe(LEGACY);
  await expect(outer).toHaveAttribute("sandbox", "allow-scripts allow-same-origin allow-downloads allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation");
  await expect(outer).toHaveAttribute(
    "allow",
    "autoplay 'src'; camera 'src'; clipboard-read 'src'; clipboard-write 'src'; display-capture 'src'; encrypted-media 'src'; fullscreen 'src'; microphone 'src'",
  );
  // The legacy widget's own iframe, in the wrapper on another origin: Element Web's attributes, constant.
  const inner = host.frame(LEGACY).locator("iframe");
  await expect(inner).toHaveAttribute("sandbox", "allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts allow-presentation allow-downloads");
  await expect(inner).toHaveAttribute("allow", "microphone; camera; encrypted-media; autoplay; display-capture; clipboard-write; clipboard-read; fullscreen");
});

test("a widget on the host's own origin is listed disabled with the reason, and nothing runs", async ({ host }) => {
  const url = new URL("/some/widget/", host.page.url()).href;
  const widget = { type: "m.widget", state_key: "same-origin", content: { name: "Same origin widget", url, uses_widget_api: true } };
  await host.populate({ userId: "@alice:dev.local", rooms: [{ id: LAB, name: "Widget lab", widgets: [widget] }], sidePanel: null, open: [{ room: LAB, widgets: ["m.widget/same-origin"] }] });
  const refused = host.button("Same origin widget cannot be opened: a widget cannot be a page of this client's own origin");
  await expect(refused).toHaveAttribute("aria-disabled", "true");
  expect((await host.main()).widgets).toEqual({});
  await expect(host.page.locator("iframe")).toHaveCount(0);
});

test("allow-top-navigation is never in the prompt and never granted", async ({ host }) => {
  await readyQuietWidget(host);
  const before = (await generation(host, NEW))!;
  await requestNext(host, NEW, [CAMERA, TOP_NAVIGATION]);
  await press(host, NEW, "request_capabilities");
  await expect(capabilityBoxes(prompt(host))).toHaveCount(1);
  await expect(browserPermissions(host).getByRole("checkbox", { name: `Use your camera (${CAMERA})` })).toBeVisible();
  await expect(prompt(host)).not.toContainText("top-navigation");
  await host.passApproveDelay();
  await prompt(host).getByRole("button", { name: "Approve 1 selected" }).click();
  await expect.poll(() => generation(host, NEW)).toBe(before + 1);
  await expect(host.iframe(NEW)).toHaveAttribute("sandbox", STRICT_SANDBOX);
  expect((await webview(host, NEW))?.applied).toEqual([CAMERA]);
});

test("a widget restarted a third time within 10 s for its webview capabilities is stopped; Retry starts it with them", async ({ host }) => {
  await readyQuietWidget(host);
  await grantCameraAndMicrophone(host);
  await host.dispatch({ type: "devTools/revokeCapabilities", widgetId: NEW, capabilities: [CAMERA], confirmed: true });
  await expect(host.iframe(NEW)).toHaveAttribute("allow", "microphone 'src'");
  // The third restart within the window: stopped instead.
  await press(host, NEW, "webview: request camera + microphone");
  await expect(capabilityBoxes(prompt(host))).toHaveCount(1);
  await host.passApproveDelay();
  await prompt(host).getByRole("button", { name: "Approve 1 selected" }).click();
  const failed = host.page.getByTestId("widget-failed");
  await expect(failed).toContainText("restarted 2 times within 10 seconds to change the permissions of its iframe");
  await expect(host.iframe(NEW)).toHaveCount(0);
  await failed.getByRole("button", { name: "Retry" }).click();
  await expect(host.iframe(NEW)).toHaveAttribute("allow", "camera 'src'; microphone 'src'");
});

test("what was granted to the widget's iframe is not carried to another URL: a reload after its state event changed starts strict", async ({ host }) => {
  await readyQuietWidget(host);
  await grantCameraAndMicrophone(host);
  await expect(host.iframe(NEW)).toHaveAttribute("allow", "camera 'src'; microphone 'src'");
  // Another member points the widget elsewhere; the running widget keeps its page until it is reloaded.
  const other = `${QUIET}&changed=1`;
  await host.dispatch({ type: "roomTools/sendState", roomId: LAB, event: { type: "m.widget", stateKey: "widget-1", content: { name: "New test widget", url: other, uses_widget_api: true } } });
  const eventUrl = async () => {
    const rooms = (await host.main()).data.rooms;
    return rooms.status === "ready" ? rooms.value.find((r) => r.id === LAB)?.widgetEvents?.find((e) => e.type === "m.widget")?.content.url : undefined;
  };
  await expect.poll(eventUrl).toBe(other);
  await host.dispatch({ type: "widget/reload", widgetId: NEW });
  await expect(host.iframe(NEW)).toHaveAttribute("src", other);
  await expect(host.iframe(NEW)).toHaveAttribute("allow", "");
  expect((await webview(host, NEW))?.applied).toEqual([]);
});

test("the driver panel shows the webview of this load; adding a webview capability restarts the widget with it", async ({ host }) => {
  await readyQuietWidget(host);
  await host.button("Dev tools of New test widget").click();
  const bar = host.page.getByRole("toolbar", { name: "Widget dev tools" });
  await bar.getByRole("button", { name: /^Messages/ }).click();
  await bar.getByRole("button", { name: /^Driver/ }).click();
  await bar.getByRole("radio", { name: "Dock to the right" }).click();
  const driver = host.page.getByTestId("devtools-driver");
  const load = driver.getByRole("group", { name: "Webview of this load" });
  // The strict default: the sandbox tokens of every widget, nothing allowed.
  await expect(load.getByRole("list", { name: "sandbox" }).getByRole("listitem")).toHaveText(["allow-scripts", "allow-same-origin"]);
  await expect(load.getByRole("list", { name: "allow" })).toHaveCount(0);
  await expect(load).toContainText("nothing");

  // "Add" of a webview capability says that it restarts the widget, and does.
  const before = (await generation(host, NEW))!;
  const field = driver.getByRole("textbox", { name: "Add capability" });
  await field.fill(CAMERA);
  await driver.getByRole("button", { name: "Add and restart" }).click();
  await expect.poll(() => generation(host, NEW)).toBe(before + 1);
  await expect(host.iframe(NEW)).toHaveAttribute("allow", "camera 'src'");
  await expect(load.getByRole("list", { name: "allow" }).getByRole("listitem")).toHaveText(["camera"]);
  await expect(load.getByRole("listitem").filter({ hasText: /^camera$/ })).toHaveAttribute("title", CAMERA);

  // The new start asks for it and gets it at once: a "webview" row, whose revoke button says that the widget restarts.
  await press(host, NEW, "notify_ready");
  await host.ready(NEW);
  await requestNext(host, NEW, [CAMERA]);
  await press(host, NEW, "request_capabilities");
  const row = driver.getByRole("list", { name: "Approved capabilities", exact: true }).locator(`[data-capability="${CAMERA}"]`);
  await expect(row).toContainText("webview");
  await expect(row.getByRole("button", { name: "Revoke this capability and restart the widget" })).toBeVisible();
  await expect(prompt(host)).toHaveCount(0);
  await field.fill(MICROPHONE);
  await expect(driver.getByRole("button", { name: "Add and restart" })).toBeEnabled();
  await host.story("widget-devtools--driver-webview");
  // Another capability is added without a restart.
  await field.fill("widget:org.matrix.mscXXXX.get_matrix_context");
  await expect(driver.getByRole("button", { name: "Add", exact: true })).toBeEnabled();
});
