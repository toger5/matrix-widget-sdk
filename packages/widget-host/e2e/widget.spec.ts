/** The WidgetView: loading, failed, the capability prompt (OpenID included), and the widget API of both test widgets. stories `widget-widgetview--*` */
import type { Locator } from "@playwright/test";

import type { HostSeed } from "../src/app/controller";
import { capabilityBoxes, expect, Host, LAB, LEGACY_WIDGET, NEW_WIDGET, test, widgetId } from "./host";

const NEW = widgetId(LAB, NEW_WIDGET);
const LEGACY = widgetId(LAB, LEGACY_WIDGET);
const SEND_MESSAGE = "widget:org.matrix.mscXXXX.send_event.timeline:m.room.message";
const SEND_TOPIC = "widget:org.matrix.mscXXXX.send_event.state:m.room.topic";
const SEND_DELAYED = "widget:org.matrix.mscXXXX.send_event.delayed";
/** The single-use capability: one OpenID token per grant. */
const GET_OPENID = "widget:org.matrix.mscXXXX.get_openid";
/** What story `widget-widgetview--capability-prompt` requests: four sections. */
const SHORT = [
  "widget:org.matrix.mscXXXX.read_timeline:m.room.message",
  "host:org.matrix.mscXXXX.forward_event.timeline:m.room.message",
  SEND_MESSAGE,
  SEND_DELAYED,
  "widget:org.matrix.mscXXXX.send_to_device:org.example.ping",
  "widget:org.matrix.mscXXXX.get_matrix_context",
];
const escape = (text: string) => new RegExp(text.replaceAll(".", "\\."));

/** A room with one widget at `url`: `?autostart=0` is a widget that says nothing until its buttons are pressed. */
const oneWidget = (url: string, extra: Partial<HostSeed> = {}): HostSeed => ({
  userId: "@alice:dev.local",
  rooms: [{ id: LAB, name: "Widget lab", widgets: [{ type: "m.widget", state_key: "widget-1", content: { name: "New test widget", url, uses_widget_api: true } }] }],
  sidePanel: null,
  open: [{ room: LAB, widgets: [NEW_WIDGET] }],
  ...extra,
});

/** A button of the test widget. Pressed with a DOM click: the widget may be covered by a prompt, or in a tab that is not shown. */
const press = (host: Host, id: string, label: string) => host.frame(id).locator("button", { hasText: label }).first().dispatchEvent("click");
/** What the test widget requests the next time request_capabilities is pressed. */
const requestNext = (host: Host, id: string, capabilities: string[]) => host.frame(id).locator("#caps").evaluate((input: HTMLInputElement, value) => (input.value = value), capabilities.join(","));
/** The log of the test widget, newest first: "<label> → <result>" or "<label> failed <error>". */
const widgetLog = (host: Host, id: string): Locator => host.frame(id).locator("#log");
const approved = (host: Host, id: string) => host.page.evaluate((i) => window.widgetHost!.driverSnapshot(i)?.approved ?? [], id);
/** "Once" / "Always" of the OpenID capability in the capability prompt. */
const lifetime = (prompt: Locator): Locator => prompt.getByRole("radiogroup", { name: /\(OpenID\): once or always$/ });
const messageBodies = async (host: Host) => (await host.store(LAB)).timeline.map((e) => (e.content as { body?: string }).body);

test.beforeEach(async ({ host }) => {
  // What "remember capabilities" stored in an earlier run.
  await host.page.evaluate(() => localStorage.clear());
});

test("a widget is loading until it sends notify_ready", async ({ host }) => {
  await host.populate(oneWidget("http://localhost:5175/new/?autostart=0", { behavior: { autoApproveCapabilities: true } }));
  const view = host.page.getByTestId("widget-view");
  await expect(view.getByTestId("widget-loading")).toContainText("Loading New test widget…");
  await expect(view.getByRole("status", { name: "Loading" })).toBeVisible();
  await expect(host.iframe(NEW)).toBeAttached();
  await host.story("widget-widgetview--loading");

  await press(host, NEW, "request_capabilities");
  await press(host, NEW, "notify_ready");
  await host.ready(NEW);
  await expect(view.getByTestId("widget-loading")).toHaveCount(0);
  await expect(host.frame(NEW).getByRole("heading", { name: "MSC4412 test widget (matrix-widget-sdk)" })).toBeVisible();
  expect(await host.actions(NEW, "fromWidget")).toContainEqual(expect.stringMatching(/\.notify_ready$/));
  await host.story("widget-widgetview--ready");
});

test("a widget that never answers fails: retry starts it again, close tab gives up", async ({ host }) => {
  await host.populate(oneWidget("http://localhost:5175/new/?autostart=0", { notifyReadyTimeoutMs: 300 }));
  const failed = host.page.getByTestId("widget-failed");
  await expect(failed.getByRole("alert")).toContainText("New test widget could not be loaded");
  await expect(failed).toContainText("The widget did not answer within 0.3 seconds.");
  await expect(failed).toContainText("http://localhost:5175/new/?autostart=0");
  await host.story("widget-widgetview--failed");

  const generation = (await host.main()).widgets[NEW].generation!;
  await failed.getByRole("button", { name: "Retry" }).click();
  await expect.poll(async () => (await host.main()).widgets[NEW].generation).toBeGreaterThan(generation);
  // The new attempt gets no answer either.
  await expect(failed).toBeVisible();

  await failed.getByRole("button", { name: "Close tab" }).click();
  await expect(host.tab(/New test widget/)).toHaveCount(0);
  await expect(host.iframe(NEW)).toHaveCount(0);
  expect((await host.main()).widgets[NEW]).toBeUndefined();
});

test("a widget that requested capabilities does not time out while the prompt is open", async ({ host }) => {
  await host.populate(oneWidget("http://localhost:5175/new/?autostart=0", { notifyReadyTimeoutMs: 2_000 }));
  await expect(host.iframe(NEW)).toBeAttached();
  await press(host, NEW, "request_capabilities");
  const prompt = host.page.getByTestId("capability-prompt");
  await expect(prompt).toBeVisible();
  // Well past the timeout: still waiting for the user, not failed.
  await host.page.waitForTimeout(2_500);
  await expect(host.page.getByTestId("widget-failed")).toHaveCount(0);
  await expect(prompt).toBeVisible();
});

test("a failed widget becomes ready when the retry is answered", async ({ host }) => {
  await host.populate(oneWidget("http://localhost:5175/new/?autostart=0", { notifyReadyTimeoutMs: 300, behavior: { autoApproveCapabilities: true } }));
  const failed = host.page.getByTestId("widget-failed");
  await expect(failed).toBeVisible();
  const generation = (await host.main()).widgets[NEW].generation!;
  await failed.getByRole("button", { name: "Retry" }).click();
  await expect.poll(async () => (await host.main()).widgets[NEW].generation).toBeGreaterThan(generation);
  await press(host, NEW, "notify_ready");
  await host.ready(NEW);
  await expect(failed).toHaveCount(0);
});

test("capability prompt: deny all, then approve a subset; the widget's actions succeed or fail accordingly", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, open: [{ room: LAB, widgets: [NEW_WIDGET] }] });
  const prompt = host.page.getByTestId("capability-prompt");
  await expect(prompt).toContainText("New test widget asks for permissions");
  // One checkbox per requested capability, all checked at first.
  const all = await host.frame(NEW).locator("#caps").evaluate((input: HTMLInputElement) => input.value.split(",").length);
  await expect(capabilityBoxes(prompt)).toHaveCount(all);
  await expect(capabilityBoxes(prompt, true)).toHaveCount(all);
  await expect(prompt).toHaveAccessibleDescription(
    // "read this room" is risky too: `paginate_timeline` makes requests to the homeserver.
    "New test widget wants to read this room, send messages as you, change the room for everyone, exchange hidden messages with devices, prove who you are to other servers, work with files, join calls and adapt to this app.",
  );
  // "Approve" is blocked for a moment after the prompt appeared; "Deny all" never is.
  await expect(prompt.getByRole("button", { name: `Approve ${all} selected` })).toHaveAttribute("aria-disabled", "true");
  await expect(prompt.getByRole("status")).toHaveText("You can approve in 3 s.");
  await prompt.getByRole("button", { name: "Deny all" }).click();
  await expect(prompt).toHaveCount(0);
  await host.ready(NEW);
  expect(await approved(host, NEW)).toEqual([]);
  await press(host, NEW, "send m.room.message");
  await expect(widgetLog(host, NEW)).toContainText("send m.room.message failed");
  expect(await messageBodies(host)).not.toContain("hello from the new widget");

  // The widget asks again: everything but the room topic.
  await press(host, NEW, "request_capabilities");
  await host.passApproveDelay();
  await expect(prompt.getByRole("status")).toHaveCount(0);
  // The long list: only the sections scroll. One row of "This app" unchecked makes its section mixed.
  const navigate = prompt.getByRole("checkbox", { name: /msc2931\.navigate/ });
  await navigate.click();
  await expect(prompt.getByRole("checkbox", { name: "All in This app" })).toHaveAttribute("aria-checked", "mixed");
  await prompt.getByRole("button", { name: "Deny all" }).evaluate((deny) => deny.closest(".prompt-card")!.querySelector(".pc-body")!.scrollTo(0, 1e6));
  await expect(prompt.getByRole("button", { name: "Deny all" })).toBeInViewport();
  await host.story("widget-widgetview--capability-prompt-long");
  await navigate.click();
  await prompt.getByRole("checkbox", { name: escape(SEND_TOPIC) }).click();
  await prompt.getByRole("button", { name: `Approve ${all - 1} selected` }).click();
  await expect(prompt).toHaveCount(0);
  await expect.poll(() => approved(host, NEW)).toContain(SEND_MESSAGE);
  expect(await approved(host, NEW)).not.toContain(SEND_TOPIC);
  expect(await approved(host, NEW)).toHaveLength(all - 1);

  await press(host, NEW, "send m.room.message");
  await expect.poll(() => messageBodies(host)).toContain("hello from the new widget");
  await press(host, NEW, "send state m.room.topic");
  await expect(widgetLog(host, NEW)).toContainText("send state m.room.topic failed");
});

test("capability prompt: a section's checkbox checks its rows; approving nothing is not offered", async ({ host }) => {
  await host.populate(oneWidget("http://localhost:5175/new/?autostart=0"));
  await requestNext(host, NEW, SHORT);
  await press(host, NEW, "request_capabilities");
  const prompt = host.page.getByTestId("capability-prompt");
  await expect(capabilityBoxes(prompt)).toHaveCount(6);
  await expect(prompt.getByRole("group", { name: /^Read this room|^Send as you|^Direct messages to devices|^You and your account/ })).toHaveCount(4);
  await expect(prompt).toHaveAccessibleDescription("New test widget wants to send messages as you, exchange hidden messages with devices, read this room and know who you are.");
  await expect(prompt.getByRole("group", { name: "Send as you" })).toContainText("2 of 2");
  await host.passApproveDelay();
  await host.story("widget-widgetview--capability-prompt");

  // A row unchecked: its section is mixed; the section's checkbox checks all of them again, then none.
  const send = prompt.getByRole("checkbox", { name: "All in Send as you" });
  await prompt.getByRole("checkbox", { name: escape(SEND_DELAYED) }).click();
  await expect(send).toHaveAttribute("aria-checked", "mixed");
  await expect(prompt.getByRole("group", { name: "Send as you" })).toContainText("1 of 2");
  await send.click();
  await expect(send).toBeChecked();
  for (const box of await prompt.getByRole("checkbox", { name: /^All in / }).all()) await box.click();
  await expect(capabilityBoxes(prompt, true)).toHaveCount(0);
  await expect(prompt.getByRole("button", { name: "Approve 0 selected" })).toBeDisabled();
  await prompt.getByRole("checkbox", { name: escape(SEND_MESSAGE) }).click();
  await prompt.getByRole("button", { name: "Approve 1 selected" }).click();
  await expect.poll(() => approved(host, NEW)).toEqual([SEND_MESSAGE]);
});

test("a request while the prompt is open joins it: the choices stay, the new one is marked, Approve is blocked again, one answer for both", async ({ host }) => {
  await host.populate(oneWidget("http://localhost:5175/new/?autostart=0"));
  const prompt = host.page.getByTestId("capability-prompt");
  const approve = prompt.getByRole("button", { name: /^Approve \d+ selected$/ });
  const status = prompt.getByRole("status");
  await requestNext(host, NEW, [SEND_MESSAGE, SEND_DELAYED]);
  await press(host, NEW, "request_capabilities");
  await expect(capabilityBoxes(prompt)).toHaveCount(2);
  await expect(approve).toHaveAttribute("aria-disabled", "true");
  await expect(status).toHaveText("You can approve in 3 s.");
  await host.passApproveDelay();
  await expect(status).toHaveCount(0);
  await expect(approve).not.toHaveAttribute("aria-disabled");
  await prompt.getByRole("checkbox", { name: escape(SEND_DELAYED) }).click();

  // The widget asks again, for the topic and one it asked for already.
  await requestNext(host, NEW, [SEND_TOPIC, SEND_MESSAGE]);
  await press(host, NEW, "request_capabilities");
  await expect(capabilityBoxes(prompt)).toHaveCount(3);
  await expect(prompt).toHaveCount(1);
  await expect(prompt.locator("label", { hasText: SEND_TOPIC })).toContainText("New");
  await expect(prompt.locator("label", { hasText: SEND_MESSAGE })).not.toContainText("New");
  await expect(prompt.getByRole("checkbox", { name: escape(SEND_TOPIC) })).toBeChecked();
  await expect(prompt.getByRole("checkbox", { name: escape(SEND_DELAYED) })).not.toBeChecked();
  await expect(approve).toHaveAttribute("aria-disabled", "true");
  await expect(status).toHaveText("1 permission was added. You can approve in 3 s.");
  await host.story("widget-widgetview--capability-prompt-merged");
  // A press on the blocked button does nothing, and neither does the intent sent past the view.
  await approve.click({ force: true });
  await host.dispatch({ type: "widget/answerCapabilities", widgetId: NEW, approved: [SEND_MESSAGE, SEND_TOPIC] });
  await expect(prompt).toBeVisible();
  expect(await host.actions(NEW, "toWidget")).not.toContainEqual(expect.stringMatching(/\.update_capabilities$/));

  await host.passApproveDelay();
  await prompt.getByRole("button", { name: "Approve 2 selected" }).click();
  await expect(prompt).toHaveCount(0);
  await expect.poll(() => approved(host, NEW)).toEqual([SEND_MESSAGE, SEND_TOPIC]);
  // Both requests were acked at once; one update_capabilities answered both.
  const messages = await host.page.evaluate((i) => window.widgetHost!.messages(i), NEW);
  const toWidget = messages.filter((m) => m.direction === "toWidget").map((m) => m.message as { action: string; request?: { allowed?: string[] }; response?: unknown });
  expect(toWidget.filter((m) => m.action.endsWith(".request_capabilities") && m.response !== undefined)).toHaveLength(2);
  expect(toWidget.filter((m) => m.action.endsWith(".update_capabilities")).map((m) => m.request?.allowed)).toEqual([[SEND_MESSAGE, SEND_TOPIC]]);
});

test("a capability revoked while the prompt is open: the card is still answered, the revoked one is not granted again", async ({ host }) => {
  await host.populate(oneWidget("http://localhost:5175/new/?autostart=0"));
  const prompt = host.page.getByTestId("capability-prompt");
  await requestNext(host, NEW, [SEND_MESSAGE]);
  await press(host, NEW, "request_capabilities");
  await expect(capabilityBoxes(prompt)).toHaveCount(1);
  await host.passApproveDelay();
  await prompt.getByRole("button", { name: "Approve 1 selected" }).click();
  await expect.poll(() => approved(host, NEW)).toEqual([SEND_MESSAGE]);

  // The widget asks again, for what it holds and one more: the card asks about the new one only.
  await requestNext(host, NEW, [SEND_MESSAGE, SEND_DELAYED]);
  await press(host, NEW, "request_capabilities");
  await expect(capabilityBoxes(prompt)).toHaveCount(1);
  await expect(prompt.getByRole("checkbox", { name: escape(SEND_DELAYED) })).toBeChecked();
  // The user takes the held one away (driver panel) while the card is open: the driver's open
  // question now holds it again, but the widget did not ask for anything new.
  await host.dispatch({ type: "devTools/revokeCapabilities", widgetId: NEW, capabilities: [SEND_MESSAGE], confirmed: true });
  await expect.poll(() => approved(host, NEW)).toEqual([]);
  await host.passApproveDelay();
  await prompt.getByRole("button", { name: "Approve 1 selected" }).click();
  await expect(prompt).toHaveCount(0);
  await expect.poll(() => approved(host, NEW)).toEqual([SEND_DELAYED]);
});

test("remembered capabilities: a widget that is opened again is not asked a second time, except about the one-use OpenID capability", async ({ host }) => {
  const seed: Partial<HostSeed> = { sidePanel: null, behavior: { rememberCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET] }] };
  await host.populate("lab", seed);
  const prompt = host.page.getByTestId("capability-prompt");
  await expect(prompt).toBeVisible();
  await host.passApproveDelay();
  await prompt.getByRole("button", { name: /^Approve \d+ selected$/ }).click();
  await expect.poll(async () => (await approved(host, NEW)).length).toBeGreaterThan(0);
  const granted = await approved(host, NEW);
  // The test widget asks for an OpenID token at the start too; that grant is for one token, never remembered.
  expect(granted).toContain(GET_OPENID);
  const remembered = granted.filter((c) => c !== GET_OPENID);
  const stored = () => host.page.evaluate(() => Object.keys(localStorage).flatMap((key) => (key.startsWith("widget_host_capabilities_v2 ") ? (JSON.parse(localStorage.getItem(key)!) as { capabilities: string[] }).capabilities : [])));
  await expect.poll(stored).toEqual(remembered);

  // Opened again, it is asked about the OpenID capability only.
  await host.populate("lab", seed);
  await host.ready(NEW);
  await expect(capabilityBoxes(prompt)).toHaveCount(1);
  await expect(prompt.getByRole("checkbox", { name: escape(GET_OPENID) })).toBeVisible();
  await prompt.getByRole("button", { name: "Deny all" }).click();
  await expect(prompt).toHaveCount(0);
  await expect.poll(() => approved(host, NEW)).toEqual(remembered);

  // A capability this app does not know is approved like any other (it allows nothing), but not remembered.
  const unknown = "widget:org.example.custom.share_screen";
  await requestNext(host, NEW, [unknown]);
  await press(host, NEW, "request_capabilities");
  await expect(prompt.getByRole("group", { name: "Unknown to this app" })).toBeVisible();
  await host.passApproveDelay();
  await prompt.getByRole("button", { name: "Approve 1 selected" }).click();
  await expect.poll(() => approved(host, NEW)).toContain(unknown);
  expect(await stored()).toEqual(remembered);
  // Opened again, the widget is asked about it again (with the OpenID capability of its start).
  await host.populate("lab", seed);
  await host.ready(NEW);
  await expect(capabilityBoxes(prompt)).toHaveCount(1);
  await requestNext(host, NEW, [unknown]);
  await press(host, NEW, "request_capabilities");
  await expect(capabilityBoxes(prompt)).toHaveCount(2);
  await expect(prompt.getByRole("group", { name: "Unknown to this app" })).toBeVisible();
});

test("an approval remembered by store version 1 (no URL, and `get_openid` meant \"may ask\" then) is dropped: the widget is asked again", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const fresh = new Host(await context.newPage());
  await fresh.page.goto("/?mode=memory");
  const v1 = `widget_host_capabilities_v1 @alice:dev.local ${LAB} ${NEW_WIDGET}`;
  await fresh.page.evaluate((key) => localStorage.setItem(key, JSON.stringify(["widget:org.matrix.mscXXXX.send_event.timeline:m.room.message", "widget:org.matrix.mscXXXX.get_openid", "widget:m.get_openid"])), v1);
  await fresh.page.goto("/?mode=memory");
  await fresh.page.waitForFunction(() => window.widgetHost?.state().screen.kind === "main");
  expect(await fresh.page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("widget_host_capabilities_")))).toEqual([]);

  await fresh.populate("lab", { sidePanel: null, behavior: { rememberCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET] }] });
  const prompt = fresh.page.getByTestId("capability-prompt");
  await expect(prompt.getByRole("checkbox", { name: escape(GET_OPENID) })).toBeVisible();
  await expect(prompt.getByRole("checkbox", { name: escape(SEND_MESSAGE) })).toBeVisible();
  await context.close();
});

test("OpenID is a one-use capability: every token is a grant of its own, asked in the capability prompt", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET] }] });
  await host.ready(NEW);
  const prompt = host.page.getByTestId("capability-prompt");
  const tokens = widgetLog(host, NEW).locator("pre", { hasText: /get_openid →.*access_token/ });
  expect(await host.page.evaluate((i) => window.widgetHost!.driverSnapshot(i)?.singleUse, NEW)).toEqual([GET_OPENID]);
  // The test widget asks for it at the start, and auto-approve granted it; the token uses it up.
  await expect.poll(() => approved(host, NEW)).toContain(GET_OPENID);
  await press(host, NEW, "get_openid");
  await expect(tokens).toHaveCount(1);
  await expect.poll(() => approved(host, NEW)).not.toContain(GET_OPENID);
  // "Auto-approve capabilities" covers it: the next token requests it again and gets it without a prompt.
  await press(host, NEW, "get_openid");
  await expect(tokens).toHaveCount(2);
  await expect(prompt).toHaveCount(0);
  // The response is the token itself; `update_capabilities` without the capability follows it.
  const wire = await host.page.evaluate((i) => window.widgetHost!.messages(i), NEW);
  const replies = wire.flatMap(({ direction, message }, index) => {
    const m = message as { action: string; response?: Record<string, unknown> };
    return direction === "toWidget" && m.action.endsWith(".get_openid") && m.response ? [{ index, response: m.response }] : [];
  });
  expect(replies).toHaveLength(2);
  for (const { index, response } of replies) {
    expect(Object.keys(response).sort()).toEqual(["access_token", "expires_in", "matrix_server_name", "token_type"]);
    const next = wire[index + 1].message as { action: string; request: { allowed: string[] } };
    expect(next.action).toBe("org.matrix.msc4412.update_capabilities");
    expect(next.request.allowed).not.toContain(GET_OPENID);
  }

  // Without auto-approve the capability prompt asks, about the one capability, for one use by default.
  await host.dispatch({ type: "mock/setBehavior", behavior: { autoApproveCapabilities: false } });
  await press(host, NEW, "get_openid");
  await expect(capabilityBoxes(prompt)).toHaveCount(1);
  await expect(prompt.getByRole("checkbox", { name: escape(GET_OPENID) })).toBeVisible();
  await expect(lifetime(prompt).getByRole("radio", { name: "Once" })).toBeChecked();
  await expect(prompt.getByRole("status")).toContainText("You can approve in");
  await host.story("widget-widgetview--capability-prompt-open-id");
  await host.passApproveDelay();
  await prompt.getByRole("button", { name: "Approve 1 selected" }).click();
  await expect(prompt).toHaveCount(0);
  await expect(tokens).toHaveCount(3);
  await expect.poll(() => approved(host, NEW)).not.toContain(GET_OPENID);
  // The next token is asked about again; denied, there is none.
  await press(host, NEW, "get_openid");
  await expect(capabilityBoxes(prompt)).toHaveCount(1);
  await prompt.getByRole("button", { name: "Deny all" }).click();
  await expect(prompt).toHaveCount(0);
  await expect(widgetLog(host, NEW).locator("pre").first()).toContainText(/get_openid failed.*blocked the OpenID request/);
  await expect(tokens).toHaveCount(3);
});

test("OpenID \"Always\": every next token without the card, remembered with the other approvals; the driver panel marks the one-use grant", async ({ host }) => {
  const seed: Partial<HostSeed> = { sidePanel: null, behavior: { autoApproveCapabilities: true, rememberCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET] }] };
  await host.populate("lab", seed);
  await host.ready(NEW);
  const prompt = host.page.getByTestId("capability-prompt");
  const tokens = widgetLog(host, NEW).locator("pre", { hasText: /get_openid →.*access_token/ });
  const stored = () => host.page.evaluate(() => Object.keys(localStorage).flatMap((key) => (key.startsWith("widget_host_capabilities_v2 ") ? (JSON.parse(localStorage.getItem(key)!) as { capabilities: string[] }).capabilities : [])));
  await host.button("Dev tools of New test widget").click();
  await host.page.getByRole("toolbar", { name: "Widget dev tools" }).getByRole("button", { name: /^Driver/ }).click();
  const driver = host.page.getByTestId("devtools-driver");
  const heldRow = driver.getByRole("list", { name: "Approved capabilities", exact: true }).locator(`[data-capability="${GET_OPENID}"]`);
  const autoRow = driver.getByRole("list", { name: "Auto-approved capabilities" }).locator(`[data-capability="${GET_OPENID}"]`);

  // Granted at the start (auto-approve), for one use: marked "once", not auto-approved, not remembered.
  await expect(heldRow).toContainText("once");
  await expect(autoRow).toHaveCount(0);
  expect(await stored()).not.toContain(GET_OPENID);
  await host.dispatch({ type: "mock/setBehavior", behavior: { autoApproveCapabilities: false } });
  await press(host, NEW, "get_openid");
  await expect(tokens).toHaveCount(1);
  await expect(heldRow).toHaveCount(0);

  // The next token asks. The choice is in the row's label, but choosing does not toggle the row; unchecked, it is disabled.
  await press(host, NEW, "get_openid");
  await expect(capabilityBoxes(prompt)).toHaveCount(1);
  const row = prompt.getByRole("checkbox", { name: escape(GET_OPENID) });
  const [once, always] = [lifetime(prompt).getByRole("radio", { name: "Once" }), lifetime(prompt).getByRole("radio", { name: "Always" })];
  await always.click();
  await expect(always).toBeChecked();
  await expect(once).not.toBeChecked();
  await expect(row).toBeChecked();
  await row.click();
  await expect(always).toBeDisabled();
  await expect(lifetime(prompt)).toHaveAttribute("aria-disabled", "true");
  await row.click();
  await expect(always).toBeEnabled();
  await expect(always).toBeChecked();
  await host.passApproveDelay();
  await prompt.getByRole("button", { name: "Approve 1 selected" }).click();
  await expect(prompt).toHaveCount(0);
  await expect(tokens).toHaveCount(2);

  // From now on every token is granted without the card: auto-approved, and remembered.
  await expect(autoRow).toHaveCount(1);
  await expect(heldRow).toHaveCount(0);
  await expect.poll(stored).toContain(GET_OPENID);
  await press(host, NEW, "get_openid");
  await expect(tokens).toHaveCount(3);
  await expect(prompt).toHaveCount(0);

  // Opened again, the widget is not asked at all: its start request gets the OpenID capability too.
  await host.populate("lab", { ...seed, behavior: { autoApproveCapabilities: false, rememberCapabilities: true } });
  await host.ready(NEW);
  await expect.poll(() => approved(host, NEW)).toContain(GET_OPENID);
  await expect(prompt).toHaveCount(0);
});

test("OpenID \"Always\" without remembering lasts while the widget runs", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, behavior: { autoApproveCapabilities: false, rememberCapabilities: false }, open: [{ room: LAB, widgets: [NEW_WIDGET] }] });
  const prompt = host.page.getByTestId("capability-prompt");
  const tokens = widgetLog(host, NEW).locator("pre", { hasText: /get_openid →.*access_token/ });
  // The start request: everything, the OpenID capability "Always".
  await expect(prompt).toBeVisible();
  await lifetime(prompt).getByRole("radio", { name: "Always" }).click();
  await host.passApproveDelay();
  await prompt.getByRole("button", { name: /^Approve \d+ selected$/ }).click();
  await expect(prompt).toHaveCount(0);
  await press(host, NEW, "get_openid");
  await press(host, NEW, "get_openid");
  await expect(tokens).toHaveCount(2);
  await expect(prompt).toHaveCount(0);
  expect(await host.page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("widget_host_capabilities_v2 ")))).toEqual([]);

  // A reload starts it again: it is asked again, the OpenID capability included, "Once" again.
  await host.dispatch({ type: "widget/reload", widgetId: NEW });
  await expect(prompt.getByRole("checkbox", { name: escape(GET_OPENID) })).toBeVisible();
  await expect(lifetime(prompt).getByRole("radio", { name: "Once" })).toBeChecked();
});

test("legacy widget: get_openid through the wrapper", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, open: [{ room: LAB, widgets: [LEGACY_WIDGET] }] });
  const prompt = host.page.getByTestId("capability-prompt");
  await expect(prompt).toContainText("Legacy test widget asks for permissions");
  // A legacy widget may always ask for a token, but the wrapper requests the capability per token, not up front.
  await expect(prompt.getByRole("checkbox", { name: /get_openid/ })).toHaveCount(0);
  const count = await capabilityBoxes(prompt).count();
  await host.passApproveDelay();
  await prompt.getByRole("button", { name: `Approve ${count} selected` }).click();
  await host.ready(LEGACY);
  const legacy = host.frame(LEGACY).frameLocator("iframe");
  const getOpenId = legacy.getByRole("button", { name: "get_openid", exact: true });
  const tokens = legacy.locator("#log pre", { hasText: /get_openid →.*access_token/ });

  // The wrapper answers `state: "request"`, requests the capability, and the user is asked.
  await getOpenId.click();
  await expect(capabilityBoxes(prompt)).toHaveCount(1);
  await expect(prompt.getByRole("checkbox", { name: escape(GET_OPENID) })).toBeVisible();
  await host.passApproveDelay();
  await prompt.getByRole("button", { name: "Approve 1 selected" }).click();
  // The token reaches the legacy widget as `openid_credentials`, and the grant is used up.
  await expect(tokens).toHaveCount(1);
  await expect(legacy.locator("#log pre", { hasText: /openid_credentials.*"state":"allowed"/ })).toHaveCount(1);
  await expect.poll(() => approved(host, LEGACY)).not.toContain(GET_OPENID);
  expect(await host.actions(LEGACY, "fromWidget")).toContain("org.matrix.mscXXXX.get_openid");

  // Denied the next time: the legacy widget is told `blocked`.
  await getOpenId.click();
  await expect(capabilityBoxes(prompt)).toHaveCount(1);
  await prompt.getByRole("button", { name: "Deny all" }).click();
  await expect(prompt).toHaveCount(0);
  await expect(legacy.locator("#log pre").first()).toContainText("get_openid failed");
  await expect(tokens).toHaveCount(1);
});

test("the legacy widget runs through the compat wrapper: one prompt with the new names, template variables resolved", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, open: [{ room: LAB, widgets: [LEGACY_WIDGET] }] });
  const prompt = host.page.getByTestId("capability-prompt");
  await expect(prompt).toContainText("Legacy test widget asks for permissions");
  // The wrapper has translated the legacy capabilities; what a legacy client gave without asking is not in the list.
  await expect(prompt.getByRole("checkbox", { name: escape(SEND_MESSAGE) })).toBeVisible();
  await expect(prompt.getByRole("checkbox", { name: /get_matrix_context/ })).toHaveCount(0);
  const count = await capabilityBoxes(prompt).count();
  await host.passApproveDelay();
  await prompt.getByRole("button", { name: `Approve ${count} selected` }).click();
  await host.ready(LEGACY);
  expect(await approved(host, LEGACY)).toContain("widget:org.matrix.mscXXXX.get_matrix_context");

  // The wrapper's iframe holds the legacy widget.
  const legacy = host.frame(LEGACY).frameLocator("iframe");
  await expect(legacy.getByRole("heading", { name: "Legacy test widget (matrix-widget-api)" })).toBeVisible();
  const state = legacy.locator("#state");
  await expect(state).toContainText('"ready": true');
  await expect(state).toContainText('"title": "Notes & more"');
  await expect(state).toContainText('"userId": "@alice:dev.local"');
  await expect(state).toContainText(`"widgetId": "`);
  await expect(state).not.toContainText("$matrix");
  await expect(state).not.toContainText("$org.matrix");

  await legacy.getByRole("button", { name: "send m.room.message" }).click();
  await expect.poll(() => messageBodies(host)).toContain("hello from the legacy widget");
});

test("a widget URL that is not http(s) is refused, also by a link that opens it at once: the room overview lists it disabled, nothing runs", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const fresh = new Host(await context.newPage());
  const pwned = () => fresh.page.evaluate(() => (window as Window & { __pwned?: unknown }).__pwned);
  const refused = (name: string) => fresh.button(`${name} cannot be opened: javascript: URLs are not allowed, only http: and https:`);

  // `?event=` with `autoload=1`: a link that would run the legacy widget (in the compat wrapper, on the host's origin) without a click.
  const legacy = { type: "im.vector.modular.widgets", state_key: "evil", content: { type: "m.custom", name: "Evil legacy widget", url: "javascript:top.__pwned=document.domain//" } };
  await fresh.page.goto(`/?mode=memory&autoload=1&event=${encodeURIComponent(JSON.stringify(legacy))}`);
  await expect(refused("Evil legacy widget")).toHaveAttribute("aria-disabled", "true");
  await refused("Evil legacy widget").click({ force: true });
  expect((await fresh.main()).widgets).toEqual({});
  await expect(fresh.page.locator("iframe")).toHaveCount(0);
  expect(await pwned()).toBeUndefined();

  // An http(s) URL without `//` is relative in an iframe of a page with the same scheme: this one
  // is the host's own compat wrapper (its origin) with a `javascript:` widget, even approved at once.
  // Also when it names a host the URL check resolves against (`base.invalid`, `a.invalid`).
  for (const host of ["", "base.invalid/../", "a.invalid/../"]) {
    const disguised = `http:/${host}widget_compatibility_wrapper/?legacy_widget_url=javascript:top.__pwned=document.domain//&legacy_widget_id=evil`;
    const wrapper = { type: "m.widget", state_key: "disguised", content: { name: "Disguised wrapper", url: disguised, uses_widget_api: true } };
    await fresh.page.goto(`/?mode=memory&autoload=1&autoApprove=1&event=${encodeURIComponent(JSON.stringify(wrapper))}`);
    const relative = fresh.button("Disguised wrapper cannot be opened: the URL is not an absolute http: or https: URL");
    await expect(relative).toHaveAttribute("aria-disabled", "true");
    expect((await fresh.main()).widgets).toEqual({});
    await expect(fresh.page.locator("iframe")).toHaveCount(0);
    expect(await pwned()).toBeUndefined();
  }

  // A seed (`populate`, `?seed=`) that opens a new-type widget whose scheme hides behind a space and capitals.
  const evil = { type: "m.widget", state_key: "evil", content: { name: "Evil widget", url: " JAVASCRIPT:top.__pwned=1//", uses_widget_api: true } };
  await fresh.populate({ userId: "@alice:dev.local", rooms: [{ id: LAB, name: "Widget lab", widgets: [evil] }], sidePanel: null, open: [{ room: LAB, widgets: ["m.widget/evil"] }] });
  await expect(refused("Evil widget")).toBeVisible();
  expect((await fresh.main()).widgets).toEqual({});
  await expect(fresh.page.locator("iframe")).toHaveCount(0);
  expect(await pwned()).toBeUndefined();
  await context.close();
});

test("the host's own compat wrapper is no widget, also by its absolute URL: listed disabled with the reason, nothing runs", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const fresh = new Host(await context.newPage());
  const pwned = () => fresh.page.evaluate(() => (window as Window & { __pwned?: unknown }).__pwned);
  await fresh.page.goto("/?mode=memory");
  const wrapper = new URL("widget_compatibility_wrapper/", fresh.page.url()).href;
  const attack = "?legacy_widget_url=javascript:top.__pwned=document.domain//&legacy_widget_id=evil";
  // The wrapper runs on the host's origin and loads its `legacy_widget_url`: as an m.widget it would be the host's origin
  // with a `javascript:` widget, approved at once. Also spelled as a server reads it (case, percent-encoding).
  for (const url of [`${wrapper}${attack}`, `${wrapper.toUpperCase()}${attack}`, `${wrapper.replace("compatibility_", "compatibility%5F")}${attack}`]) {
    const event = { type: "m.widget", state_key: "absolute", content: { name: "Absolute wrapper", url, uses_widget_api: true } };
    await fresh.page.goto(`/?mode=memory&autoload=1&autoApprove=1&event=${encodeURIComponent(JSON.stringify(event))}`);
    const refused = fresh.button("Absolute wrapper cannot be opened: a widget cannot load this client's compat wrapper");
    await expect(refused).toHaveAttribute("aria-disabled", "true");
    expect((await fresh.main()).widgets).toEqual({});
    await expect(fresh.page.locator("iframe")).toHaveCount(0);
    expect(await pwned()).toBeUndefined();
  }
  await context.close();
});

test("the compat wrapper loads only http(s) URLs, before and after templating, also when its host answers", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const fresh = new Host(await context.newPage());
  const pwned = () => fresh.page.evaluate(() => (window as Window & { __pwned?: unknown }).__pwned);

  // A legacy widget whose URL the host accepts (`$server` is a host name to the URL parser) but whose templated URL is
  // no URL (the `:` of the value is URI-encoded): the wrapper refuses to load it after templating. The widget never
  // gets ready, so it stays hidden.
  const legacy = { type: "im.vector.modular.widgets", state_key: "templated", content: { type: "m.custom", name: "Templated", url: "https://$server/legacy/", data: { server: "widgets.example:8443" } } };
  await fresh.page.goto(`/?mode=memory&autoload=1&autoApprove=1&event=${encodeURIComponent(JSON.stringify(legacy))}`);
  const wrapped = fresh.page.frameLocator("iframe[data-widget-id]");
  await expect(wrapped.locator("#error")).toHaveText("Widget compat wrapper: refused to load the legacy widget: the URL is not an absolute http: or https: URL");
  await expect(wrapped.locator("iframe")).toHaveCount(0);

  // The wrapper loaded directly, on the host's origin, with a `javascript:` legacy widget, and a parent that answers
  // its bootstrap as a host would: the wrapper refuses the URL before it talks to the parent.
  await fresh.page.evaluate((src) => {
    const frame = document.createElement("iframe");
    frame.id = "direct";
    window.addEventListener("message", (ev) => {
      const m = ev.data as { source?: string; action?: string; request_id?: string; request?: { capabilities?: string[] }; response?: unknown };
      if (ev.source !== frame.contentWindow || m.source !== "widget" || m.response !== undefined) return;
      const asks = m.action?.endsWith(".request_capabilities");
      frame.contentWindow!.postMessage({ ...m, response: asks ? {} : { error: { code: "org.matrix.msc4412.unknown_action", message: "no" } } }, "*");
      if (asks) frame.contentWindow!.postMessage({ source: "host", request_id: "u1", action: "org.matrix.msc4412.update_capabilities", request: { allowed: m.request?.capabilities ?? [] } }, "*");
    });
    frame.src = src;
    document.body.append(frame);
  }, `/widget_compatibility_wrapper/?legacy_widget_url=${encodeURIComponent("javascript:top.__pwned=document.domain//")}&legacy_widget_id=evil`);
  const direct = fresh.page.frameLocator("#direct");
  await expect(direct.locator("#error")).toHaveText("Widget compat wrapper: refused `legacy_widget_url`: javascript: URLs are not allowed, only http: and https:");
  await expect(direct.locator("iframe")).toHaveCount(0);
  expect(await pwned()).toBeUndefined();
  await context.close();
});

test("a widget sends m.room.message: it lands in the room, and the other widget of the room is told", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET, LEGACY_WIDGET], active: NEW_WIDGET }] });
  await host.ready(NEW);
  await host.ready(LEGACY);
  const before = (await host.store(LAB)).timeline.length;

  await host.frame(NEW).getByRole("button", { name: "send m.room.message" }).click();
  await expect.poll(async () => (await host.store(LAB)).timeline.length).toBe(before + 1);
  expect((await host.store(LAB)).timeline.at(-1)).toMatchObject({ eventType: "m.room.message", sender: "@alice:dev.local", content: { msgtype: "m.text", body: "hello from the new widget" } });
  // The sender gets its own event echoed, and the legacy widget (in the tab that is not shown) gets it too.
  await expect(widgetLog(host, NEW)).toContainText(/forward_event .*hello from the new widget/);
  await expect.poll(() => host.actions(LEGACY, "toWidget")).toContainEqual(expect.stringMatching(/\.forward_event$/));

  // And the other way round.
  await host.tab(/Legacy test widget/).click();
  await host.frame(LEGACY).frameLocator("iframe").getByRole("button", { name: "send m.room.message" }).click();
  await expect.poll(() => messageBodies(host)).toContain("hello from the legacy widget");
  await expect(widgetLog(host, NEW)).toContainText(/forward_event .*hello from the legacy widget/);
});

test("legacy widget: read_events through the wrapper reads the timeline cache, and paginates while short (resolved in the DevBackendView); state reads still answer", async ({ host }) => {
  type LegacyEvent = { event_id: string; type: string; content: { body?: string; topic?: string } };
  await host.populate("lab", { behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [LEGACY_WIDGET] }] });
  await host.ready(LEGACY);
  const legacy = host.frame(LEGACY).frameLocator("iframe");
  const log = legacy.locator("#log");
  const READ = "read m.room.message (limit 10)";
  /** Press a button of the legacy widget and return what it logged for it (a JSON result, or its error). */
  const press = async (label: string) => {
    const entries = log.locator("pre", { hasText: label });
    const count = await entries.count();
    await legacy.getByRole("button", { name: label, exact: true }).click();
    await expect(entries).toHaveCount(count + 1, { timeout: 9_000 });
    const text = (await entries.first().textContent())!;
    expect(text, text).toContain(`${label} →`);
    return JSON.parse(text.slice(text.indexOf("→") + 1)) as LegacyEvent[];
  };
  const view = host.page.getByTestId("devbackend-view");
  const timelineToggle = view.getByRole("toolbar", { name: "Room dev tools" }).getByRole("button", { name: /^Timeline/ });
  if ((await timelineToggle.getAttribute("aria-pressed")) === "false") await timelineToggle.click();
  const request = view.getByRole("form", { name: "Pagination request" });

  // The room has three messages: the wrapper reads them, asks the host for 7 more and waits.
  const entries = log.locator("pre", { hasText: READ });
  await legacy.getByRole("button", { name: READ, exact: true }).click();
  await expect(request).toContainText("7 requested");
  // The legacy widget is still waiting for its answer.
  await expect(entries).toHaveCount(0);
  await request.getByRole("button", { name: "Resolve" }).click();
  await expect(entries).toHaveCount(1);
  const text = (await entries.first().textContent())!;
  const read = JSON.parse(text.slice(text.indexOf("→") + 1)) as LegacyEvent[];
  // Newest first, as Element Web answers: the room's three messages, then the seven fetched ones.
  const timeline = (await host.store(LAB)).timeline as { eventId: string; eventType: string }[];
  const messages = timeline.filter((e) => e.eventType === "m.room.message").map((e) => e.eventId);
  expect(read.map((e) => e.event_id)).toEqual(messages.slice(-10).reverse());
  expect(read.slice(0, 3).map((e) => e.content.body)).toEqual([
    "The landscape picture is in the media repository.",
    "Yes, both of them. Try the legacy one too.",
    "Is the new widget up?",
  ]);
  const actions = await host.actions(LEGACY, "fromWidget");
  expect(actions).toEqual(expect.arrayContaining(["org.matrix.mscXXXX.read_timeline", "org.matrix.mscXXXX.paginate_timeline"]));
  // The host has no read_events: the wrapper translated it.
  expect(actions).not.toContain("org.matrix.msc2876.read_events");
  // The wrapper took the notifications; the legacy widget never saw one.
  expect(await host.actions(LEGACY, "toWidget")).toContain("org.matrix.mscXXXX.notify_timeline_update");
  await expect(log).not.toContainText("notify_timeline_update");

  // Now the cache has ten: the answer comes from it, without a pagination.
  const paginations = (await host.actions(LEGACY, "fromWidget")).filter((a) => a.endsWith("paginate_timeline")).length;
  expect((await press(READ)).map((e) => e.event_id)).toEqual(messages.slice(-10).reverse());
  expect((await host.actions(LEGACY, "fromWidget")).filter((a) => a.endsWith("paginate_timeline"))).toHaveLength(paginations);
  await expect(request).toHaveCount(0);

  // A state read is answered from what the host pushed with update_state.
  const [topic] = await press("read state m.room.topic");
  expect(topic).toMatchObject({ type: "m.room.topic", content: { topic: "Both test widgets, a few people and something to read" } });
});
