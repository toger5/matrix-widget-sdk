/** DevBackendView › State: the shortcuts, "send state" (widget, Element Call and raw JSON forms), the state explorer and "edit state"; widget state events add and remove widget tiles. */
import { expect, type Host, LAB, test, widgetId } from "./host";

type StateEvent = { eventType: string; stateKey: string; content: Record<string, unknown> };
const stateOf = async (host: Host, type: string, stateKey = "") => ((await host.store(LAB)).state as StateEvent[]).find((e) => e.eventType === type && e.stateKey === stateKey)?.content;
const stateForm = (host: Host, name: "Widget" | "Element Call" | "Raw JSON") => host.page.getByRole("tablist", { name: "State form" }).getByRole("tab", { name }).click();

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
  await host.leaf("devbackend/state");

  await stateForm(host, "Raw JSON");
  await expect(form.getByLabel("State content (JSON)")).toHaveValue(/Both test widgets/);
  await host.leaf("devbackend/state-raw");
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
  await host.leaf("devbackend/state-edit");

  await editor.fill("[1]");
  await view.locator(".editor").getByRole("button", { name: "Save" }).click();
  await expect(view.locator(".editor").getByRole("alert")).toContainText("must be an object");

  await editor.fill('{ "topic": "Edited in place" }');
  await view.locator(".editor").getByRole("button", { name: "Save" }).click();
  await expect(editor).toHaveCount(0);
  await expect(view.locator("pre.code")).toContainText("Edited in place");
  expect(await stateOf(host, "m.room.topic")).toEqual({ topic: "Edited in place" });
});

test("the widget form adds a test widget that opens, and a legacy one; a widget state event without url removes it", async ({ host }) => {
  const view = host.page.getByTestId("devbackend-view");
  const form = view.getByRole("form", { name: "Send state" });
  const tile = host.panels.getByRole("button", { name: "Open Whiteboard" });
  await expect(host.panels.getByTestId("widget-tiles").getByRole("button")).toHaveCount(2);

  // Prefilled with the new test widget under the first free widget ID.
  await expect(form.getByLabel("Event type")).toHaveValue("m.widget");
  await expect(form.getByLabel("URL")).toHaveValue("http://localhost:5175/new/");
  // Only http(s) URLs: the URL becomes the src of an iframe.
  await form.getByLabel("URL").fill("javascript:alert(1)");
  await form.getByRole("button", { name: "Send" }).click();
  await expect(form.getByRole("alert")).toHaveText("The URL must start with http:// or https://.");
  expect(await stateOf(host, "m.widget", "widget-2")).toBeUndefined();
  await form.getByLabel("URL").fill("http://localhost:5175/new/");
  await form.getByLabel("Name").fill("Whiteboard");
  await form.getByRole("button", { name: "Send" }).click();
  await expect(tile).toBeVisible();
  await expect(host.panels.getByTitle("3 widgets")).toBeVisible();
  expect(await stateOf(host, "m.widget", "widget-2")).toEqual({ name: "Whiteboard", url: "http://localhost:5175/new/", uses_widget_api: true });

  await tile.click();
  await host.ready(widgetId(LAB, "m.widget/widget-2"));
  await expect(host.tab("Whiteboard")).toBeVisible();

  // The legacy event type prefills the legacy test widget (the edited name stays) and is embedded through the compat wrapper.
  await form.getByLabel("Event type").selectOption("im.vector.modular.widgets");
  await expect(form.getByLabel("URL")).toHaveValue(/^http:\/\/localhost:5175\/legacy\/\?/);
  await expect(form.getByRole("switch", { name: "Uses the widget API" })).toHaveCount(0);
  await form.getByLabel("Widget ID").fill("board-legacy");
  await form.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => stateOf(host, "im.vector.modular.widgets", "board-legacy")).toMatchObject({ type: "m.custom", name: "Whiteboard", creatorUserId: "@alice:dev.local", waitForIframeLoad: true });
  await expect(host.panels.getByTitle("4 widgets")).toBeVisible();

  await stateForm(host, "Raw JSON");
  await form.getByLabel("Type").fill("im.vector.modular.widgets");
  await form.getByLabel("State key").fill("board-legacy");
  await form.getByLabel("State content (JSON)").fill("{}");
  await form.getByRole("button", { name: "Send" }).click();
  await expect(host.panels.getByTitle("3 widgets")).toBeVisible();
  expect(await stateOf(host, "im.vector.modular.widgets", "board-legacy")).toEqual({});
});

test("the Element Call form writes the call widget as Element Web describes it, and the compat wrapper fills in its URL", async ({ host }) => {
  const view = host.page.getByTestId("devbackend-view");
  const form = view.getByRole("form", { name: "Send state" });
  // Only the State section open, as the leaf draws it.
  await view.getByRole("button", { name: /^Timeline \d/ }).click();
  await stateForm(host, "Element Call");
  await expect(form.getByLabel("Element Call URL")).toHaveValue("https://call.element.io/room");
  await host.leaf("devbackend/state-element-call");

  await form.getByLabel("Element Call URL").fill("javascript:alert(1)");
  await form.getByRole("button", { name: "Send" }).click();
  await expect(form.getByRole("alert")).toContainText("must start with http");

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
  await expect(chips.getByRole("tab", { name: "Widget" })).toHaveAttribute("aria-selected", "true");
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
