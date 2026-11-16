/** The WidgetView: loading, failed, the capability and OpenID prompts, and the widget API of both test widgets. leaves widgetview/* */
import type { Locator } from "@playwright/test";

import type { HostSeed } from "../src/app/controller";
import { capabilityBoxes, expect, Host, LAB, LEGACY_WIDGET, NEW_WIDGET, test, widgetId } from "./host";

const NEW = widgetId(LAB, NEW_WIDGET);
const LEGACY = widgetId(LAB, LEGACY_WIDGET);
const SEND_MESSAGE = "widget:org.matrix.mscXXXX.send_event.timeline:m.room.message";
const SEND_TOPIC = "widget:org.matrix.mscXXXX.send_event.state:m.room.topic";
const SEND_DELAYED = "widget:org.matrix.mscXXXX.send_event.delayed";
/** What leaf widgetview/prompt requests: four sections. */
const SHORT = [
  "widget:org.matrix.msc2876.read_events.timeline:m.room.message",
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
  await host.leaf("widgetview/loading");

  await press(host, NEW, "request_capabilities");
  await press(host, NEW, "notify_ready");
  await host.ready(NEW);
  await expect(view.getByTestId("widget-loading")).toHaveCount(0);
  await expect(host.frame(NEW).getByRole("heading", { name: "MSC4412 test widget (widget-base-sdk)" })).toBeVisible();
  expect(await host.actions(NEW, "fromWidget")).toContainEqual(expect.stringMatching(/\.notify_ready$/));
  await host.leaf("widgetview/plain");
});

test("a widget that never answers fails: retry starts it again, close tab gives up", async ({ host }) => {
  await host.populate(oneWidget("http://localhost:5175/new/?autostart=0", { notifyReadyTimeoutMs: 300 }));
  const failed = host.page.getByTestId("widget-failed");
  await expect(failed.getByRole("alert")).toContainText("New test widget could not be loaded");
  await expect(failed).toContainText("The widget did not answer within 0.3 seconds.");
  await expect(failed).toContainText("http://localhost:5175/new/?autostart=0");
  await host.leaf("widgetview/failed");

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
    "New test widget wants to send messages as you, change the room for everyone, exchange hidden messages with devices, prove who you are to other servers, read this room, work with files, join calls and adapt to this app.",
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
  await host.leaf("widgetview/prompt-long");
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
  await host.leaf("widgetview/prompt");

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
  await host.leaf("widgetview/prompt-merged");
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

test("remembered capabilities: a widget that is opened again is not asked a second time", async ({ host }) => {
  const seed: Partial<HostSeed> = { sidePanel: null, behavior: { rememberCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET] }] };
  await host.populate("lab", seed);
  const prompt = host.page.getByTestId("capability-prompt");
  await expect(prompt).toBeVisible();
  await host.passApproveDelay();
  await prompt.getByRole("button", { name: /^Approve \d+ selected$/ }).click();
  await expect.poll(async () => (await approved(host, NEW)).length).toBeGreaterThan(0);
  const granted = await approved(host, NEW);

  await host.populate("lab", seed);
  await host.ready(NEW);
  await expect.poll(() => approved(host, NEW)).toEqual(granted);
  await expect(prompt).toHaveCount(0);

  // A capability this app does not know is approved like any other (it allows nothing), but not remembered.
  const unknown = "widget:org.example.custom.share_screen";
  const stored = () => host.page.evaluate(() => Object.keys(localStorage).flatMap((key) => (key.startsWith("widget_host_capabilities_v1 ") ? (JSON.parse(localStorage.getItem(key)!) as string[]) : [])));
  await requestNext(host, NEW, [unknown]);
  await press(host, NEW, "request_capabilities");
  await expect(prompt.getByRole("group", { name: "Unknown to this app" })).toBeVisible();
  await host.passApproveDelay();
  await prompt.getByRole("button", { name: "Approve 1 selected" }).click();
  await expect.poll(() => approved(host, NEW)).toContain(unknown);
  expect(await stored()).toEqual(expect.arrayContaining(granted));
  expect(await stored()).not.toContain(unknown);
  // Opened again, the widget is asked about it again.
  await host.populate("lab", seed);
  await host.ready(NEW);
  await expect.poll(() => approved(host, NEW)).toEqual(granted);
  await requestNext(host, NEW, [unknown]);
  await press(host, NEW, "request_capabilities");
  await expect(capabilityBoxes(prompt)).toHaveCount(1);
  await expect(prompt.getByRole("group", { name: "Unknown to this app" })).toBeVisible();
});

test("OpenID prompt: block, allow, and auto-approve", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET] }] });
  await host.ready(NEW);
  const prompt = host.page.getByTestId("openid-prompt");

  await press(host, NEW, "get_openid");
  await expect(prompt).toContainText("New test widget asks for your identity");
  await prompt.getByRole("button", { name: "Block" }).click();
  await expect(prompt).toHaveCount(0);
  await expect(widgetLog(host, NEW)).toContainText("get_openid failed");

  await press(host, NEW, "get_openid");
  await prompt.getByRole("button", { name: "Allow" }).click();
  await expect(prompt).toHaveCount(0);
  await expect(widgetLog(host, NEW).locator("pre").first()).toContainText(/get_openid →.*access_token/);

  // "auto-approve OpenID tokens" of the DevBackendView applies to the running widget.
  await host.dispatch({ type: "mock/setBehavior", behavior: { autoApproveOpenId: true } });
  await press(host, NEW, "get_openid");
  await expect(widgetLog(host, NEW).locator("pre", { hasText: /get_openid →.*access_token/ })).toHaveCount(2);
  await expect(prompt).toHaveCount(0);
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
