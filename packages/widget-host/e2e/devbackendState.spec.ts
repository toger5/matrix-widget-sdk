/** DevBackendView › State: the shortcuts, "send state" (test widget, widget, Element Call and raw JSON forms; "Update widget"), the state explorer and "edit state"; widget state events add and remove widgets of the room overview. */
import { expect, type Host, LAB, NEW_WIDGET, test, widgetId } from "./host";

type StateEvent = { eventType: string; stateKey: string; content: Record<string, unknown> };
const stateOf = async (host: Host, type: string, stateKey = "") => ((await host.store(LAB)).state as StateEvent[]).find((e) => e.eventType === type && e.stateKey === stateKey)?.content;
const stateForm = (host: Host, name: "Test widget" | "Widget" | "Element Call" | "Raw JSON") => host.page.getByRole("tablist", { name: "State form" }).getByRole("tab", { name, exact: true }).click();

test.beforeEach(async ({ host }) => {
  await host.populate("lab", { open: [{ room: LAB }] });
  // The drafts and the filter are state of the section, which outlives `populate`: reopening the section resets them.
  const section = host.page.getByTestId("devbackend-view").getByRole("button", { name: /^State \d/ });
  await section.click();
  await section.click();
});

test("shortcuts: edit name, edit description and add member change the room", async ({ host }) => {
  const view = host.page.getByTestId("devbackend-view");

  await view.getByRole("button", { name: "Edit name" }).click();
  await expect(view.getByLabel("Room name")).toHaveValue("Widget lab");
  await view.getByLabel("Room name").fill("Renamed lab");
  await view.getByRole("form", { name: "Edit name" }).getByRole("button", { name: "Save" }).click();
  await expect(view.getByRole("button", { name: /^Renamed lab !lab/ })).toBeVisible();
  await expect(host.panels.locator(".room-name")).toHaveText("Renamed lab");
  expect(await stateOf(host, "m.room.name")).toEqual({ name: "Renamed lab" });

  await view.getByRole("button", { name: "Edit description" }).click();
  await view.getByRole("textbox", { name: "Description" }).fill("A new description");
  await view.getByRole("textbox", { name: "Description" }).press("Enter");
  await expect.poll(() => stateOf(host, "m.room.topic")).toEqual({ topic: "A new description" });

  await view.getByRole("button", { name: "Add member" }).click();
  await view.getByLabel("User ID").fill("dave");
  await view.getByRole("form", { name: "Add member" }).getByRole("button", { name: "Add" }).click();
  await expect(view.getByRole("alert")).toContainText("@user:server");
  await view.getByLabel("User ID").fill("@dave:dev.local");
  await view.getByRole("form", { name: "Add member" }).getByRole("button", { name: "Add" }).click();
  await expect(host.panels.getByTitle("4 members")).toBeVisible();
  expect(await stateOf(host, "m.room.member", "@dave:dev.local")).toEqual({ membership: "join" });
});

test("send state and the state explorer: the sent event is listed by type and key", async ({ host }) => {
  const view = host.page.getByTestId("devbackend-view");
  const form = view.getByRole("form", { name: "Send state" });
  await view.getByRole("button", { name: /^Timeline \d/ }).click();

  await view.getByRole("button", { name: "m.room.member 3" }).click();
  await view.getByRole("button", { name: "State key @bob:dev.local of m.room.member" }).click();
  await expect(view.locator("pre.code")).toContainText('"displayname": "Bob"');
  await expect(form.getByLabel("Widget ID")).toHaveValue("widget-2");
  await host.story("sidepanel-devbackendview--state");

  await stateForm(host, "Raw JSON");
  await expect(form.getByLabel("State content (JSON)")).toHaveValue(/Both test widgets/);
  await host.story("sidepanel-devbackendview-state--raw-json");
  await form.getByLabel("Type").fill("org.example.setting");
  await form.getByLabel("State key").fill("colour");
  await form.getByLabel("State content (JSON)").fill("{ broken");
  await form.getByRole("button", { name: "Send" }).click();
  await expect(form.getByRole("alert")).toContainText("Invalid JSON");
  expect(await stateOf(host, "org.example.setting", "colour")).toBeUndefined();

  await form.getByLabel("State content (JSON)").fill('{ "value": "green" }');
  await form.getByRole("button", { name: "Send" }).click();
  await expect(form.getByRole("alert")).toHaveCount(0);
  expect(await stateOf(host, "org.example.setting", "colour")).toEqual({ value: "green" });

  await view.getByRole("button", { name: "org.example.setting 1" }).click();
  await view.getByRole("button", { name: "State key colour of org.example.setting" }).click();
  await expect(view.locator("pre.code")).toContainText("green");

  await view.getByLabel("Filter state by type or key").fill("topic");
  await expect(view.getByRole("button", { name: "org.example.setting 1" })).toHaveCount(0);
  await expect(view.getByRole("button", { name: "State key (empty) of m.room.topic" })).toBeVisible();
});

test("edit state: saving the editor sends a new state event", async ({ host }) => {
  const view = host.page.getByTestId("devbackend-view");
  await view.getByRole("button", { name: /^Timeline \d/ }).click();
  await view.getByRole("button", { name: "m.room.topic 1" }).click();
  await view.getByRole("button", { name: "Edit state event m.room.topic (empty state key)" }).click();
  const editor = view.getByLabel("Content of m.room.topic (empty state key) (JSON)");
  await expect(editor).toHaveValue(/Both test widgets/);
  await view.locator(".editor").getByRole("button", { name: "Save" }).scrollIntoViewIfNeeded();
  await host.story("sidepanel-devbackendview-state--edit");

  await editor.fill("[1]");
  await view.locator(".editor").getByRole("button", { name: "Save" }).click();
  await expect(view.locator(".editor").getByRole("alert")).toContainText("must be an object");

  await editor.fill('{ "topic": "Edited in place" }');
  await view.locator(".editor").getByRole("button", { name: "Save" }).click();
  await expect(editor).toHaveCount(0);
  await expect(view.locator("pre.code")).toContainText("Edited in place");
  expect(await stateOf(host, "m.room.topic")).toEqual({ topic: "Edited in place" });
});

test("the test widget form sends the three test widgets, its URL read-only; “Update widget” for a widget the room has", async ({ host }) => {
  const view = host.page.getByTestId("devbackend-view");
  const form = view.getByRole("form", { name: "Send state" });
  const url = form.getByRole("textbox", { name: "URL" });
  // The two test widgets of the room.
  await expect(host.panels.getByTestId("room-overview").locator(".ov-widgets").getByRole("button")).toHaveCount(2);

  // The default form: the new test widget as m.widget under the first free widget ID. The URL cannot be edited, only copied.
  await expect(host.page.getByRole("tablist", { name: "State form" }).getByRole("tab", { name: "Test widget" })).toHaveAttribute("aria-selected", "true");
  await expect(form.getByLabel("Test widget")).toHaveValue("m.widget");
  await expect(form.getByLabel("Widget ID")).toHaveValue("widget-2");
  await expect(url).toHaveValue("http://localhost:5175/new/");
  await expect(url).not.toBeEditable();
  await form.getByRole("button", { name: "Copy the URL" }).click();
  await expect(host.page.getByTestId("toast")).toContainText("URL copied");
  expect(await host.page.evaluate(() => navigator.clipboard.readText())).toBe("http://localhost:5175/new/");

  // The ID of the room's new test widget: "Update widget" instead of "Send".
  // Only the State section open and Bob's membership shown, as the stories draw it.
  await view.getByRole("button", { name: /^Timeline \d/ }).click();
  await view.getByRole("button", { name: "m.room.member 3" }).click();
  await view.getByRole("button", { name: "State key @bob:dev.local of m.room.member" }).click();
  await form.getByLabel("Widget ID").fill("widget-1");
  await expect(form.getByRole("button", { name: "Update widget" })).toBeVisible();
  await expect(form.getByRole("button", { name: "Send" })).toHaveCount(0);
  await host.story("sidepanel-devbackendview-state--update-widget");
  // The same ID under another event type is another widget.
  await form.getByLabel("Test widget").selectOption("org.matrix.msc4411.widget");
  await expect(url).toHaveValue("http://localhost:5175/new/");
  await form.getByRole("button", { name: "Send" }).click();
  await expect(host.panels.getByTitle("3 widgets")).toBeVisible();
  expect(await stateOf(host, "org.matrix.msc4411.widget", "widget-1")).toEqual({ name: "MSC4411 test widget", url: "http://localhost:5175/new/", uses_widget_api: true });
  // Sent: the same draft now updates it.
  await expect(form.getByRole("button", { name: "Update widget" })).toBeVisible();
  await host.panels.getByRole("button", { name: "Open MSC4411 test widget" }).click();
  await host.ready(widgetId(LAB, "org.matrix.msc4411.widget/widget-1"));
  await expect(host.tab("MSC4411 test widget")).toBeVisible();

  // The legacy test widget: its templated URL and the legacy fields, the account as its creator.
  await form.getByLabel("Test widget").selectOption("im.vector.modular.widgets");
  await expect(url).toHaveValue(/^http:\/\/localhost:5175\/legacy\/\?title=\$title&/);
  await form.getByLabel("Widget ID").fill("legacy-2");
  await form.getByRole("button", { name: "Send" }).click();
  await expect(host.panels.getByTitle("4 widgets")).toBeVisible();
  expect(await stateOf(host, "im.vector.modular.widgets", "legacy-2")).toMatchObject({ type: "m.custom", name: "Legacy test widget", creatorUserId: "@alice:dev.local", waitForIframeLoad: true, data: { title: "Notes & more" } });
  await expect(form.getByRole("button", { name: "Update widget" })).toBeVisible();

  // A widget state event without url removes the widget: its ID sends again.
  await stateForm(host, "Raw JSON");
  await form.getByLabel("Type").fill("im.vector.modular.widgets");
  await form.getByLabel("State key").fill("legacy-2");
  await form.getByLabel("State content (JSON)").fill("{}");
  await form.getByRole("button", { name: "Send" }).click();
  await expect(host.panels.getByTitle("3 widgets")).toBeVisible();
  expect(await stateOf(host, "im.vector.modular.widgets", "legacy-2")).toEqual({});
  await stateForm(host, "Test widget");
  await expect(form.getByLabel("Widget ID")).toHaveValue("legacy-2");
  await expect(form.getByRole("button", { name: "Send" })).toBeVisible();
});

test("the widget form sends any custom widget: it starts empty, only http(s) URLs; a legacy one gets the legacy fields", async ({ host }) => {
  const view = host.page.getByTestId("devbackend-view");
  const form = view.getByRole("form", { name: "Send state" });
  const openWhiteboard = host.panels.getByRole("button", { name: "Open Whiteboard" });
  await stateForm(host, "Widget");
  await expect(form.getByLabel("Event type")).toHaveValue("m.widget");
  await expect(form.getByLabel("Widget ID")).toHaveValue("widget-2");
  await expect(form.getByLabel("Name")).toHaveValue("");
  await expect(form.getByLabel("URL")).toHaveValue("");
  // Only the State section open and Bob's membership shown, as the stories draw it.
  await view.getByRole("button", { name: /^Timeline \d/ }).click();
  await view.getByRole("button", { name: "m.room.member 3" }).click();
  await view.getByRole("button", { name: "State key @bob:dev.local of m.room.member" }).click();
  await host.story("sidepanel-devbackendview-state--widget");

  // Only http(s) URLs: the URL becomes the src of an iframe.
  await form.getByLabel("Name").fill("Whiteboard");
  await form.getByLabel("URL").fill("javascript:alert(1)");
  await form.getByRole("button", { name: "Send" }).click();
  await expect(form.getByRole("alert")).toHaveText("The URL cannot be embedded: javascript: URLs are not allowed, only http: and https:.");
  expect(await stateOf(host, "m.widget", "widget-2")).toBeUndefined();
  await form.getByLabel("URL").fill("http://localhost:5175/new/?board=1");
  await form.getByRole("button", { name: "Send" }).click();
  await expect(openWhiteboard).toBeVisible();
  await expect(host.panels.getByTitle("3 widgets")).toBeVisible();
  expect(await stateOf(host, "m.widget", "widget-2")).toEqual({ name: "Whiteboard", url: "http://localhost:5175/new/?board=1", uses_widget_api: true });
  await expect(form.getByRole("button", { name: "Update widget" })).toBeVisible();

  await openWhiteboard.click();
  await host.ready(widgetId(LAB, "m.widget/widget-2"));
  await expect(host.tab("Whiteboard")).toBeVisible();

  // The legacy event type keeps name and URL and is embedded through the compat wrapper.
  await form.getByLabel("Event type").selectOption("im.vector.modular.widgets");
  await expect(form.getByLabel("URL")).toHaveValue("http://localhost:5175/new/?board=1");
  await expect(form.getByRole("switch", { name: "Uses the widget API" })).toHaveCount(0);
  await expect(form.getByRole("button", { name: "Send" })).toBeVisible();
  await form.getByLabel("Widget ID").fill("board-legacy");
  await form.getByRole("button", { name: "Send" }).click();
  await expect(host.panels.getByTitle("4 widgets")).toBeVisible();
  expect(await stateOf(host, "im.vector.modular.widgets", "board-legacy")).toEqual({
    type: "m.custom",
    name: "Whiteboard",
    url: "http://localhost:5175/new/?board=1",
    waitForIframeLoad: true,
    creatorUserId: "@alice:dev.local",
  });
});

test("the Element Call form writes the call widget as Element Web describes it, and the compat wrapper fills in its URL", async ({ host }) => {
  const view = host.page.getByTestId("devbackend-view");
  const form = view.getByRole("form", { name: "Send state" });
  // Only the State section open, as the story draws it.
  await view.getByRole("button", { name: /^Timeline \d/ }).click();
  await stateForm(host, "Element Call");
  await expect(form.getByLabel("Element Call URL")).toHaveValue("https://call.element.io/room");
  await host.story("sidepanel-devbackendview-state--element-call");

  await form.getByLabel("Element Call URL").fill("javascript:alert(1)");
  await form.getByRole("button", { name: "Send" }).click();
  await expect(form.getByRole("alert")).toHaveText("The Element Call URL cannot be embedded: javascript: URLs are not allowed, only http: and https:.");

  // The legacy test widget stands in for Element Call (which is loaded from the internet), to see the URL the compat wrapper loads.
  await form.getByLabel("Element Call URL").fill("http://localhost:5175/legacy/#ignored");
  await form.getByLabel("Intent").selectOption("join_existing");
  await form.getByRole("button", { name: "Send" }).click();
  await expect(form.getByRole("alert")).toHaveCount(0);
  expect(await stateOf(host, "im.vector.modular.widgets", "element-call")).toEqual({
    type: "m.call",
    name: "Element Call",
    url: "http://localhost:5175/legacy/#?intent=join_existing&roomId=$matrix_room_id&userId=$matrix_user_id&deviceId=$org.matrix.msc3819.matrix_device_id&baseUrl=$org.matrix.msc4039.matrix_base_url&lang=$org.matrix.msc2873.client_language&theme=$org.matrix.msc2873.client_theme",
    waitForIframeLoad: false,
    creatorUserId: "@alice:dev.local",
  });

  // Every variable is filled in; `widgetId` and `parentUrl` are in the query, where Element Call also looks.
  await host.panels.getByRole("button", { name: "Open Element Call" }).click();
  const loaded = () =>
    host.page
      .frames()
      .map((f) => f.url())
      .filter((u) => u.startsWith("http://localhost:5175/legacy/"))
      .map((u) => new URL(u))
      .find((u) => u.searchParams.get("widgetId") === "element-call");
  await expect.poll(() => loaded()?.href).toBeDefined();
  const url = loaded()!;
  expect(url.href).not.toContain("$");
  expect(url.searchParams.get("parentUrl")).toMatch(/\/widget_compatibility_wrapper\/$/);
  expect(Object.fromEntries(new URLSearchParams(url.hash.slice(2)))).toEqual({
    intent: "join_existing",
    roomId: LAB,
    userId: "@alice:dev.local",
    deviceId: "DEVBACKEND",
    baseUrl: "https://matrix.dev.local",
    lang: await host.page.evaluate(() => navigator.language),
    theme: expect.stringMatching(/^(light|dark)$/),
  });

  // The form chips are a tablist: the arrow keys, Home and End select a form.
  const chips = host.page.getByRole("tablist", { name: "State form" });
  await chips.getByRole("tab", { name: "Element Call" }).focus();
  await host.page.keyboard.press("ArrowRight");
  await expect(chips.getByRole("tab", { name: "Raw JSON" })).toBeFocused();
  await expect(chips.getByRole("tab", { name: "Raw JSON" })).toHaveAttribute("aria-selected", "true");
  await expect(form.getByLabel("State content (JSON)")).toBeVisible();
  await host.page.keyboard.press("Home");
  await expect(chips.getByRole("tab", { name: "Test widget" })).toHaveAttribute("aria-selected", "true");
  await host.page.keyboard.press("ArrowLeft");
  await expect(chips.getByRole("tab", { name: "Raw JSON" })).toBeFocused();
});

test("delayed state: the event is scheduled and “Send now” applies it", async ({ host }) => {
  const view = host.page.getByTestId("devbackend-view");
  const form = view.getByRole("form", { name: "Send state" });
  await stateForm(host, "Raw JSON");
  await form.getByLabel("State content (JSON)").fill('{ "topic": "Later" }');
  await form.getByRole("switch", { name: "Send delayed" }).check();
  await form.getByLabel("Delay in milliseconds").fill("60000");
  await form.getByRole("button", { name: "Schedule" }).click();

  const scheduled = view.getByRole("list", { name: "Scheduled events" }).getByRole("listitem");
  await expect(scheduled).toContainText(["m.room.topic"]);
  await expect(scheduled).toContainText(["state · (empty key)"]);
  expect((await host.store(LAB)).delayed).toHaveLength(1);
  expect(await stateOf(host, "m.room.topic")).not.toEqual({ topic: "Later" });

  await scheduled.getByRole("button", { name: "Send now" }).click();
  await expect(scheduled).toHaveCount(0);
  expect(await stateOf(host, "m.room.topic")).toEqual({ topic: "Later" });
});

test("the state is read like a real room's: a widget's state event reaches the state explorer through the room's timeline", async ({ host }) => {
  const NEW = widgetId(LAB, NEW_WIDGET);
  await host.populate("lab", { behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET] }] });
  await host.ready(NEW);
  const view = host.page.getByTestId("devbackend-view");
  const timeline = view.getByRole("button", { name: /^Timeline \d+ events/ });
  const before = Number((await timeline.textContent())?.match(/(\d+) events/)?.[1]);
  await view.getByRole("button", { name: "m.room.topic 1", exact: true }).click();
  await view.getByRole("button", { name: "State key (empty) of m.room.topic" }).click();
  const topic = view.locator(".tree pre.code");
  await expect(topic).not.toContainText("hello from the new widget");

  // The widget writes to the room's backend directly: only the refresh after its message sees it.
  await host.frame(NEW).getByRole("button", { name: "send state m.room.topic" }).click();
  await expect(topic).toContainText('"topic": "hello from the new widget"');
  await expect(timeline).toHaveAccessibleName(`Timeline ${before + 1} events`);
  expect(await stateOf(host, "m.room.topic")).toEqual({ topic: "hello from the new widget" });
});
