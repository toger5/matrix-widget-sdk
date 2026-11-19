/** The RoomOverview: what the room name tab shows and where a room opens; topic, members and widgets of the room. */
import type { StateEvent } from "../src/widgetStateEvent";
import { expect, type Host, LAB, LEGACY_WIDGET, NEW_WIDGET, test, widgetId } from "./host";

const header = "Widget lab · open the room overview";

test("a room opens on its overview: the room name is selected; topic, members and widgets", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, settings: { devTools: false }, open: [{ room: LAB }] });
  const roomTab = host.tab("Widget lab");
  await expect(roomTab).toHaveAttribute("aria-selected", "true");
  await expect(roomTab).toHaveAttribute("title", header);
  await expect(roomTab.getByTitle("2 widgets")).toHaveText("2");
  await expect(roomTab.getByTitle("3 members")).toHaveText("3");

  const overview = host.overview;
  await expect(overview.getByRole("heading", { name: "Widget lab", level: 1 })).toBeVisible();
  await expect(overview.getByText(LAB)).toBeVisible();
  await expect(overview.getByText("Both test widgets, a few people and something to read")).toBeVisible();
  await expect(overview.locator(".member b")).toHaveText(["Alice", "Bob", "Carol"]);
  await expect(overview.getByText("@carol:dev.local")).toBeVisible();
  await expect(overview.locator(".ov-widgets button")).toHaveText([/New test widget/, /Legacy test widget/]);
  await expect(overview.getByText("Copy to DevBackend")).toHaveCount(0);
  await expect(overview.getByRole("button", { name: "Open timeline" })).toHaveAttribute("title", "Open the timeline of this room in a new tab");
  await host.story("rooms-roomoverview--plain");
});

test("pressing a widget in the overview opens it as a new tab at the end; the room name shows the overview again, where it is grayed out", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, open: [{ room: LAB, widgets: [NEW_WIDGET], overview: true }] });
  const overview = host.overview;
  await expect(host.tab("Widget lab")).toHaveAttribute("aria-selected", "true");

  await overview.getByRole("button", { name: "Open Legacy test widget" }).click();
  await expect(host.page.getByRole("tab")).toHaveText([/Widget lab/, /New test widget/, /Legacy test widget/]);
  await expect(host.tab(/Legacy test widget/)).toHaveAttribute("aria-selected", "true");
  await host.ready(widgetId(LAB, LEGACY_WIDGET));

  // A widget that is already open has no "Open" button: "Jump to tab" brings its tab to the front, no second one.
  await host.page.getByTitle(header).click();
  await expect(host.tab("Widget lab")).toHaveAttribute("aria-selected", "true");
  await expect(overview.locator(".ov-widgets").getByRole("button", { name: /^Open / })).toHaveCount(0);
  await overview.getByRole("button", { name: "Jump to the tab of Legacy test widget" }).click();
  await expect(host.page.getByRole("tab")).toHaveCount(3);
  await expect(host.tab(/Legacy test widget/)).toHaveAttribute("aria-selected", "true");
});

/** A local widget ("Add widget", only in this host): the new test widget under another ID. */
const LOCAL: StateEvent = { type: "m.widget", state_key: "proto", content: { name: "Poll prototype", url: "http://localhost:5175/new/", uses_widget_api: true } };
const LOCAL_KEY = "local:m.widget/proto";
/** The state keys of the widget state events of the mocked room. */
const roomWidgetKeys = async (host: Host) => ((await host.store(LAB)).state as { eventType: string; stateKey: string }[]).filter((e) => e.eventType === "m.widget").map((e) => e.stateKey);
/** The keys of the remembered capabilities of the lab room (`widget_host_capabilities_v2 <user> <room> <widget>`). */
const rememberedKeys = (host: Host) =>
  host.page.evaluate((room) => Object.keys(localStorage).flatMap((key) => (key.startsWith(`widget_host_capabilities_v2 @alice:dev.local ${room} `) ? [key.split(" ")[3]] : [])).sort(), LAB);
const forgetRemembered = (host: Host) => host.page.evaluate(() => Object.keys(localStorage).forEach((key) => key.startsWith("widget_host_capabilities_v2 ") && localStorage.removeItem(key)));

test("with dev tools enabled: “Add widget” and the local widgets after the room's; a DevBackend room has no “Copy to DevBackend” card", async ({ host }) => {
  // A seed ends a panel on a widget tab (`active`) or on the room name (`overview`), not both.
  await expect(host.populate("lab", { sidePanel: null, open: [{ room: LAB, widgets: [NEW_WIDGET], overview: true, active: NEW_WIDGET }] })).rejects.toThrow(/both `active` and `overview`/);
  await expect(host.populate("lab", { localWidgets: { "!nope:dev.local": [LOCAL] } })).rejects.toThrow(/seed.localWidgets: unknown room/);
  await host.populate("lab", { sidePanel: null, localWidgets: { [LAB]: [LOCAL] }, open: [{ room: LAB, widgets: [NEW_WIDGET], timeline: true, overview: true }] });
  expect((await host.state()).settings.devTools).toBe(true);
  const overview = host.overview;
  await expect(overview.locator(".member")).toHaveCount(3);
  await expect(host.button("Dev tools of New test widget")).toHaveCount(1);
  await expect(overview.getByRole("button", { name: "Jump to the tab of New test widget" })).toBeVisible();
  // The panel has its Timeline tab: the header shows it instead of opening a second one.
  await expect(overview.getByRole("button", { name: "Show timeline" })).toHaveAttribute("title", "Show the timeline tab");
  await expect(overview.getByRole("button", { name: "Open timeline" })).toHaveCount(0);
  // The local widget comes last, marked, and counts in the room name tab.
  await expect(overview.locator(".ov-widgets b")).toHaveText(["New test widget", "Legacy test widget", "Poll prototype"]);
  const local = overview.locator(`[data-widget-key="${LOCAL_KEY}"]`);
  await expect(local.locator(".pill")).toHaveText("Local");
  await expect(host.tab("Widget lab").getByTitle("3 widgets")).toHaveText("3");
  await expect(overview.getByRole("button", { name: "Add widget" })).toHaveAttribute("title", "Add a widget to this room");
  await expect(local.getByRole("button", { name: "Edit Poll prototype" })).toBeVisible();
  await expect(local.getByRole("button", { name: "Remove Poll prototype" })).toBeVisible();
  // A DevBackend room is already in the DevBackend, so the DevBackend card of story `rooms-roomoverview--dev-tools` is not reachable here.
  await expect(overview.getByText("Copy to DevBackend")).toHaveCount(0);
  await host.story("rooms-roomoverview--dev-tools");

  // Without dev tools a local widget is still listed and runs; it can be removed, not added or edited.
  await host.dispatch({ type: "settings/set", settings: { devTools: false } });
  await expect(overview.getByRole("button", { name: "Add widget" })).toHaveCount(0);
  await expect(local.getByRole("button", { name: "Edit Poll prototype" })).toHaveCount(0);
  await expect(local.getByRole("button", { name: "Remove Poll prototype" })).toBeVisible();
  await local.getByRole("button", { name: "Open Poll prototype" }).click();
  await expect(host.tab(/Poll prototype/)).toHaveAttribute("aria-selected", "true");
  await expect(host.prompt).toBeVisible();
  expect(await roomWidgetKeys(host)).toEqual(["widget-1"]);
});

test("Add widget, only in this host: listed as “Local”, nothing is sent; it asks for its capabilities, remembered apart from the room widget's", async ({ host }) => {
  await forgetRemembered(host);
  await host.populate("lab", { sidePanel: null, behavior: { rememberCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET] }] });
  const prompt = host.prompt;
  await expect(prompt).toBeVisible();
  await host.approve();
  await expect.poll(() => rememberedKeys(host)).toEqual([NEW_WIDGET]);

  await host.tab("Widget lab").click();
  const overview = host.overview;
  await overview.getByRole("button", { name: "Add widget" }).click();
  const form = overview.getByRole("form", { name: "Add widget" });
  // The test widget form: the new test widget under the first ID no widget of the room uses, its URL read-only.
  await expect(form.getByRole("tab", { name: "Test widget" })).toHaveAttribute("aria-selected", "true");
  await expect(form.getByRole("textbox", { name: "Widget ID" })).toHaveValue("widget-2");
  await expect(form.getByRole("textbox", { name: "URL" })).toHaveValue("http://localhost:5175/new/");
  await expect(form.getByRole("textbox", { name: "URL" })).not.toBeEditable();
  await expect(form.getByRole("radio", { name: "Only in this host" })).toBeChecked();
  await expect(form.getByText("Nothing is sent to the room")).toBeVisible();
  await expect(overview.getByRole("button", { name: "Add widget" })).toHaveCount(1); // the form's own; the card's is replaced by the form
  await host.story("rooms-roomoverview--add-widget");

  // The widget form: any custom widget, it starts empty. The same type and ID as the room's widget: its key is still its own.
  await form.getByRole("tab", { name: "Widget", exact: true }).click();
  await expect(form.getByRole("textbox", { name: "URL" })).toHaveValue("");
  await host.story("rooms-roomoverview--add-widget-custom");
  await form.getByRole("textbox", { name: "Widget ID" }).fill("widget-1");
  await form.getByRole("textbox", { name: "Name" }).fill("Local test widget");
  // A page of the compat wrapper is refused, and the form says why.
  await form.getByRole("textbox", { name: "URL" }).fill(new URL("/widget_compatibility_wrapper/?legacy_widget_url=x", host.page.url()).href);
  await form.getByRole("button", { name: "Add widget" }).click();
  await expect(form.getByRole("alert")).toContainText("The URL cannot be embedded: a widget cannot load this client's compat wrapper.");
  await form.getByRole("textbox", { name: "URL" }).fill("http://localhost:5175/new/");
  await form.getByRole("button", { name: "Add widget" }).click();
  await expect(form).toHaveCount(0);
  const row = overview.locator('[data-widget-key="local:m.widget/widget-1"]');
  await expect(row).toContainText("Local test widget");
  await expect(row.locator(".pill")).toHaveText("Local");
  // Added, not opened, and not sent to the room.
  await expect(host.page.getByRole("tab")).toHaveCount(2);
  expect(await roomWidgetKeys(host)).toEqual(["widget-1"]);
  expect((await host.main()).data.localWidgets[LAB]).toEqual([
    { type: "m.widget", state_key: "widget-1", content: { name: "Local test widget", url: "http://localhost:5175/new/", uses_widget_api: true } },
  ]);

  await row.getByRole("button", { name: "Open Local test widget" }).click();
  await expect(prompt).toBeVisible();
  await host.approve();
  await expect.poll(() => rememberedKeys(host)).toEqual(["local:m.widget/widget-1", NEW_WIDGET]);
  await host.ready(widgetId(LAB, "local:m.widget/widget-1"));
});

test("a widget on this host's own origin can be added; opening it asks first, \"Open anyway\" only with dev tools", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, open: [{ room: LAB }] });
  const overview = host.overview;
  await overview.getByRole("button", { name: "Add widget" }).click();
  const form = overview.getByRole("form", { name: "Add widget" });
  await form.getByRole("tab", { name: "Widget", exact: true }).click();
  // A static file of the host: harmless, and ready once loaded (no widget API).
  const url = new URL("/demo/notes.txt", host.page.url()).href;
  await form.getByRole("textbox", { name: "Widget ID" }).fill("own-page");
  await form.getByRole("textbox", { name: "Name" }).fill("Own page");
  await form.getByRole("textbox", { name: "URL" }).fill(url);
  await form.getByRole("switch", { name: "Uses the widget API" }).click();
  await form.getByRole("button", { name: "Add widget" }).click();
  await expect(form).toHaveCount(0);

  const id = widgetId(LAB, "local:m.widget/own-page");
  const open = overview.getByRole("button", { name: "Open Own page" });
  const ask = host.page.getByTestId("widget-same-origin");
  await open.click();
  await expect(ask.getByRole("group", { name: "Own page runs on this app's own site" })).toHaveAccessibleDescription(
    `It comes from ${new URL(url).origin}, like this app itself, so it could read and change your data and your login here. Open it only if you trust it as much as this site.`,
  );
  await expect(host.iframe(id)).toHaveCount(0);
  await host.story("widget-widgetview--same-origin-dev-tools");

  // "Open anyway" loads it; a reload does not ask again, another URL does.
  await ask.getByRole("button", { name: "Open anyway" }).click();
  await host.ready(id);
  await expect(host.iframe(id)).toHaveAttribute("src", url);
  await host.dispatch({ type: "widget/reload", widgetId: id });
  await host.ready(id);
  const moved = { type: "m.widget", state_key: "own-page", content: { name: "Own page", url: `${url}?v=2`, uses_widget_api: false } };
  await host.dispatch({ type: "room/addWidget", roomId: LAB, event: moved, target: "local" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Close tab" }).click();
  expect((await host.main()).widgets[id]).toBeUndefined();

  // Without dev tools it cannot be opened.
  await host.dispatch({ type: "settings/set", settings: { devTools: false } });
  await open.click();
  await expect(ask.getByRole("button")).toHaveText(["Close tab"]);
  await host.story("widget-widgetview--same-origin");
});

test("Add widget, Paste JSON: a whole state event, other fields ignored; not a widget type or not an http(s) URL is refused in the form", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, open: [{ room: LAB }] });
  const overview = host.overview;
  await overview.getByRole("button", { name: "Add widget" }).click();
  const form = overview.getByRole("form", { name: "Add widget" });
  await form.getByRole("tab", { name: "Paste JSON" }).click();
  const json = form.getByRole("textbox", { name: "Widget state event (JSON)" });
  const add = form.getByRole("button", { name: "Add widget" });
  const refusal = form.getByRole("alert");

  await json.fill(JSON.stringify({ type: "m.room.topic", state_key: "", content: { topic: "x" } }));
  await add.click();
  await expect(refusal).toContainText("The widget cannot be added");
  await expect(refusal).toContainText("The type must be a widget type");
  await json.fill(JSON.stringify({ type: "m.widget", state_key: "x", content: { name: "X", url: "javascript:top.__pwned=1//" } }));
  await add.click();
  await expect(refusal).toContainText("javascript: URLs are not allowed, only http: and https:");
  await json.fill("{ not json");
  await add.click();
  await expect(refusal).toContainText("Invalid JSON");
  expect((await host.main()).data.localWidgets[LAB]).toBeUndefined();

  // As Element's room state explorer shows it.
  const pasted = {
    type: "im.vector.modular.widgets",
    state_key: "etherpad_1763294567",
    sender: "@ada:example.org",
    content: { type: "m.etherpad", name: "Etherpad", url: "https://pad.example.org/p/design-crit?userId=$matrix_user_id", data: {} },
    event_id: "$Wq3bH0kTzNcEw7aLrY2mPq",
    origin_server_ts: 1763294567000,
  };
  await json.fill(JSON.stringify(pasted, null, 2));
  // Editing the draft takes the refusal away.
  await expect(refusal).toHaveCount(0);
  await host.story("rooms-roomoverview--add-widget-json");
  await add.click();
  await expect(form).toHaveCount(0);
  await expect(overview.locator('[data-widget-key="local:im.vector.modular.widgets/etherpad_1763294567"]')).toContainText("Etherpad");
  expect((await host.main()).data.localWidgets[LAB]).toEqual([{ type: pasted.type, state_key: pasted.state_key, content: pasted.content }]);
  // The intent checks it too (the test hook can send anything).
  await host.dispatch({ type: "room/addWidget", roomId: LAB, target: "local", event: { type: "m.widget", state_key: "y", content: { url: "data:text/html,x" } } });
  await expect(host.toast).toContainText("data: URLs are not allowed");
  expect((await host.main()).data.localWidgets[LAB]).toHaveLength(1);
});

test("Add widget, to the room: the state event is sent as you; replacing a widget of the room asks first; a refusal stays in the form with the draft", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, open: [{ room: LAB }] });
  const overview = host.overview;
  const form = overview.getByRole("form", { name: "Add widget" });
  const modal = host.page.getByRole("alertdialog");
  const addToRoom = async (id: string, name: string) => {
    await overview.getByRole("button", { name: "Add widget" }).click();
    await form.getByRole("tab", { name: "Widget", exact: true }).click();
    await form.getByRole("textbox", { name: "Widget ID" }).fill(id);
    await form.getByRole("textbox", { name: "Name" }).fill(name);
    await form.getByRole("textbox", { name: "URL" }).fill("http://localhost:5175/new/");
    await form.getByRole("radio", { name: "The room" }).click();
    await expect(form.getByText("everyone in it sees the widget")).toBeVisible();
    await form.getByRole("button", { name: "Add widget" }).click();
  };

  await addToRoom("widget-2", "Room widget");
  await expect(form).toHaveCount(0);
  expect(await roomWidgetKeys(host)).toEqual(["widget-1", "widget-2"]);
  const row = overview.locator('[data-widget-key="m.widget/widget-2"]');
  await expect(row).toContainText("Room widget");
  await expect(row.locator(".pill")).toHaveCount(0);
  await expect(host.tab("Widget lab").getByTitle("3 widgets")).toHaveText("3");

  // Replacing it asks; cancelling keeps the form and its draft.
  await addToRoom("widget-2", "Room widget, again");
  await expect(modal).toContainText("Replace Room widget in the room?");
  await modal.getByRole("button", { name: "Cancel" }).click();
  await expect(form.getByRole("textbox", { name: "Name" })).toHaveValue("Room widget, again");
  await form.getByRole("button", { name: "Add widget" }).click();
  await modal.getByRole("button", { name: "Replace the widget" }).click();
  await expect(form).toHaveCount(0);
  await expect(row).toContainText("Room widget, again");

  // The room refuses ("fail sends" of the DevBackend): the reason is shown, the draft stays and can go to this host instead.
  await host.dispatch({ type: "mock/setFailSends", on: true });
  await addToRoom("widget-3", "Refused widget");
  const refusal = form.getByRole("alert");
  await expect(refusal).toContainText("The room refused the widget");
  await expect(refusal).toContainText("simulated failure (fail sends is on)");
  await expect(form.getByRole("textbox", { name: "Name" })).toHaveValue("Refused widget");
  expect((await host.main()).widgetWrite).toMatchObject({ roomId: LAB, widgetKey: "m.widget/widget-3", state: "failed" });
  await host.story("rooms-roomoverview--add-widget-refused");
  await form.getByRole("radio", { name: "Only in this host" }).click();
  await form.getByRole("button", { name: "Add widget" }).click();
  await expect(form).toHaveCount(0);
  await expect(overview.locator('[data-widget-key="local:m.widget/widget-3"]')).toContainText("Refused widget");
  expect((await host.main()).widgetWrite).toBeUndefined();
  expect(await roomWidgetKeys(host)).toEqual(["widget-1", "widget-2"]);

  // Cancel forgets a refusal.
  await addToRoom("widget-4", "Refused again");
  await expect(form.getByRole("alert")).toContainText("The room refused the widget");
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toHaveCount(0);
  expect((await host.main()).widgetWrite).toBeUndefined();

  // Only to a room whose widgets are known (else replacing one could not ask first).
  await host.dispatch({ type: "room/addWidget", roomId: "!nope:dev.local", target: "room", event: { type: "m.widget", state_key: "x", content: { name: "X", url: "http://localhost:5175/new/" } } });
  await expect(host.toast).toContainText("!nope:dev.local is not a room of this account");
  expect((await host.main()).widgetWrite).toBeUndefined();
});

test("a local widget: editing its URL forgets its capabilities and reloads it; removing it closes its tab", async ({ host }) => {
  await forgetRemembered(host);
  const id = widgetId(LAB, LOCAL_KEY);
  await host.populate("lab", { sidePanel: null, behavior: { rememberCapabilities: true }, localWidgets: { [LAB]: [LOCAL] }, open: [{ room: LAB, widgets: [LOCAL_KEY] }] });
  const prompt = host.prompt;
  await expect(prompt).toBeVisible();
  await host.approve();
  await host.ready(id);
  await expect.poll(() => rememberedKeys(host)).toEqual([LOCAL_KEY]);
  const token = await host.token(id);

  // Edit: type and ID are fixed; only the name changes nothing that runs.
  await host.tab("Widget lab").click();
  const overview = host.overview;
  await overview.getByRole("button", { name: "Edit Poll prototype" }).click();
  const form = overview.getByRole("form", { name: "Edit Poll prototype" });
  await expect(form.getByRole("tab")).toHaveCount(0);
  await expect(form.getByRole("radiogroup", { name: "Add to" })).toHaveCount(0);
  await expect(form.getByRole("textbox", { name: "Event type" })).toHaveAttribute("readonly", "");
  await expect(form.getByRole("textbox", { name: "Widget ID" })).toHaveAttribute("readonly", "");
  await host.story("rooms-addwidgetform--edit");
  await form.getByRole("textbox", { name: "Name" }).fill("Poll prototype 2");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toHaveCount(0);
  await expect(host.tab(/Poll prototype 2/)).toBeVisible();
  expect(await host.token(id)).toBe(token);
  expect(await rememberedKeys(host)).toEqual([LOCAL_KEY]);

  // A new URL: what was approved is forgotten and the widget reloads, so it asks again.
  await overview.getByRole("button", { name: "Edit Poll prototype 2" }).click();
  await overview.getByRole("form", { name: "Edit Poll prototype 2" }).getByRole("textbox", { name: "URL" }).fill("http://localhost:5175/new/?v=2");
  await overview.getByRole("form", { name: "Edit Poll prototype 2" }).getByRole("button", { name: "Save" }).click();
  await expect.poll(() => rememberedKeys(host)).toEqual([]);
  await expect.poll(async () => (await host.main()).widgets[id]?.widget.url).toBe("http://localhost:5175/new/?v=2");
  await overview.getByRole("button", { name: "Jump to the tab of Poll prototype 2" }).click();
  await expect(prompt).toBeVisible();
  expect(await host.token(id)).not.toBe(token);
  await host.approve();
  await expect.poll(() => rememberedKeys(host)).toEqual([LOCAL_KEY]);

  // Remove (while its edit form is open): asks first; the widget stops, its tab and the form close, what was approved is forgotten; the room is not changed.
  await host.tab("Widget lab").click();
  await overview.getByRole("button", { name: "Edit Poll prototype 2" }).click();
  await expect(overview.getByRole("form", { name: "Edit Poll prototype 2" })).toBeVisible();
  await overview.getByRole("button", { name: "Remove Poll prototype 2" }).click();
  const modal = host.page.getByRole("alertdialog");
  await expect(modal).toContainText("Remove Poll prototype 2?");
  await modal.getByRole("button", { name: "Remove the widget" }).click();
  await expect(host.page.getByRole("tab")).toHaveCount(1);
  expect(await host.page.evaluate(() => window.widgetHost!.widgets())).toEqual([]);
  await expect(overview.locator(`[data-widget-key="${LOCAL_KEY}"]`)).toHaveCount(0);
  await expect(overview.getByRole("form")).toHaveCount(0);
  await expect(overview.getByRole("button", { name: "Add widget" })).toBeVisible();
  expect((await host.main()).data.localWidgets[LAB]).toBeUndefined();
  expect(await rememberedKeys(host)).toEqual([]);
  expect(await roomWidgetKeys(host)).toEqual(["widget-1"]);
});

test("a local legacy widget replaced with other `data` (the values of its URL's variables) forgets its capabilities and reloads", async ({ host }) => {
  await forgetRemembered(host);
  const legacy: StateEvent = {
    type: "im.vector.modular.widgets",
    state_key: "notes",
    content: { type: "m.custom", name: "Local notes", url: "http://localhost:5175/legacy/?title=$title&widgetId=$matrix_widget_id&userId=$matrix_user_id", data: { title: "A" } },
  };
  const key = "local:im.vector.modular.widgets/notes";
  const id = widgetId(LAB, key);
  await host.populate("lab", { sidePanel: null, behavior: { rememberCapabilities: true }, localWidgets: { [LAB]: [legacy] }, open: [{ room: LAB, widgets: [key] }] });
  const prompt = host.prompt;
  await expect(prompt).toContainText("Local notes asks for permissions");
  await host.approve();
  await host.ready(id);
  await expect.poll(() => rememberedKeys(host)).toEqual([key]);
  const token = await host.token(id);

  // The same URL with other `data` (a pasted event with the same type and ID replaces it) can be another page, even another origin.
  await host.dispatch({ type: "room/addWidget", roomId: LAB, target: "local", event: { ...legacy, content: { ...legacy.content, data: { title: "B" } } } });
  await expect.poll(() => rememberedKeys(host)).toEqual([]);
  await expect(prompt).toContainText("Local notes asks for permissions");
  expect(await host.token(id)).not.toBe(token);
});
