/** DevBackendView › Timeline: the predefined forms, the raw JSON form and delayed events. Every sent event reaches the store and a running widget. */
import { expect, type Host, LAB, NEW_WIDGET, test, widgetId } from "./host";

const NEW = widgetId(LAB, NEW_WIDGET);
type TimelineEvent = { eventType: string; sender: string; content: Record<string, unknown> };
const last = async (host: Host) => ((await host.store(LAB)).timeline as TimelineEvent[]).at(-1)!;
const forwards = async (host: Host) => (await host.actions(NEW, "toWidget")).filter((a) => a.endsWith("forward_event")).length;

test.beforeEach(async ({ host }) => {
  await host.populate("lab", { behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET] }] });
  await host.ready(NEW);
  const view = host.page.getByTestId("devbackend-view");
  await view.getByRole("button", { name: /^State \d/ }).click();
  // The drafts are state of the section, which outlives `populate`: reopening the section resets them.
  await view.getByRole("button", { name: /^Timeline \d/ }).click();
  await view.getByRole("button", { name: /^Timeline \d/ }).click();
});

/** The widget only asks to be told about messages and reactions: ask for another event type too. */
async function follow(host: Host, type: string) {
  const before = (await host.actions(NEW, "toWidget")).length;
  await host.frame(NEW).locator("#caps").fill(`host:org.matrix.mscXXXX.forward_event.timeline:${type}`);
  await host.frame(NEW).getByRole("button", { name: "request_capabilities" }).click();
  await expect(host.frame(NEW).locator("#state")).toContainText(`forward_event.timeline:${type}`);
  return before;
}

test("message form: the event is added to the timeline and forwarded to the widget", async ({ host }) => {
  const view = host.page.getByTestId("devbackend-view");
  const form = view.getByRole("form", { name: "Send event" });
  const events = view.getByRole("list", { name: "Timeline events" }).getByRole("listitem");
  const count = await events.count();
  const forwarded = await forwards(host);

  await form.getByRole("button", { name: "Send" }).click();
  await expect(form.getByRole("alert")).toHaveText("The body is missing.");
  await expect(events).toHaveCount(count);

  await form.getByLabel("Sender").fill("@bob:dev.local");
  await form.getByLabel("Body").fill("Hello from the DevBackendView");
  await form.getByRole("button", { name: "Send" }).click();
  await expect(events).toHaveCount(count + 1);
  await expect(events.first()).toContainText("“Hello from the DevBackendView”");
  await expect(events.first()).toContainText("@bob:dev.local");
  expect(await last(host)).toMatchObject({ eventType: "m.room.message", sender: "@bob:dev.local", content: { msgtype: "m.text", body: "Hello from the DevBackendView" } });
  await expect.poll(() => forwards(host)).toBe(forwarded + 1);
  await expect(host.frame(NEW).locator("#log")).toContainText("Hello from the DevBackendView");
  await host.story("sidepanel-devbackendview--timeline");

  await events.first().getByRole("button").click();
  await expect(events.first().locator("pre.code")).toContainText("origin_server_ts");
});

test("sticker form: needs an mxc:// URI, then sends m.sticker", async ({ host }) => {
  const view = host.page.getByTestId("devbackend-view");
  const form = view.getByRole("form", { name: "Send event" });
  await follow(host, "m.sticker");
  const forwarded = await forwards(host);

  await view.getByRole("tab", { name: "Sticker" }).click();
  await form.getByLabel("Body").fill("Party parrot");
  await form.getByLabel("MXC URL").fill("https://example.org/parrot.png");
  await form.getByRole("button", { name: "Send" }).click();
  await expect(form.getByRole("alert")).toContainText("mxc://");

  await form.getByLabel("MXC URL").fill("mxc://dev.local/parrot");
  await form.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => last(host)).toMatchObject({ eventType: "m.sticker", content: { body: "Party parrot", url: "mxc://dev.local/parrot" } });
  await expect.poll(() => forwards(host)).toBe(forwarded + 1);
});

test("RTC member form: sends a membership, and an empty content when not joined", async ({ host }) => {
  const view = host.page.getByTestId("devbackend-view");
  const form = view.getByRole("form", { name: "Send event" });
  await follow(host, "org.matrix.msc4143.rtc.member");
  const forwarded = await forwards(host);

  await view.getByRole("tab", { name: "RTC member" }).click();
  await form.getByLabel("Device ID").fill("ALICEPHONE");
  await form.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => last(host)).toMatchObject({ eventType: "org.matrix.msc4143.rtc.member", content: { device_id: "ALICEPHONE" } });

  await form.getByRole("switch", { name: "Joined" }).click();
  await form.getByRole("button", { name: "Send" }).click();
  await expect.poll(async () => (await last(host)).content).toEqual({});
  await expect.poll(() => forwards(host)).toBe(forwarded + 2);
});

test("image / audio form: sends an m.room.message with the chosen message type", async ({ host }) => {
  const view = host.page.getByTestId("devbackend-view");
  const form = view.getByRole("form", { name: "Send event" });
  const forwarded = await forwards(host);

  await view.getByRole("tab", { name: "Image / audio" }).click();
  await form.getByLabel("Message type").selectOption("m.audio");
  await form.getByLabel("MXC URL").fill("mxc://dev.local/jingle");
  await form.getByLabel("Body").fill("jingle.ogg");
  await form.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => last(host)).toMatchObject({ eventType: "m.room.message", content: { msgtype: "m.audio", url: "mxc://dev.local/jingle", body: "jingle.ogg" } });
  await expect.poll(() => forwards(host)).toBe(forwarded + 1);
});

test("raw JSON form: invalid JSON shows an error and sends nothing, a valid event is sent", async ({ host }) => {
  const view = host.page.getByTestId("devbackend-view");
  const form = view.getByRole("form", { name: "Send event" });
  const editor = form.getByLabel("Event (JSON)");
  const count = (await host.store(LAB)).timeline.length;
  const forwarded = await forwards(host);

  await view.getByRole("tablist", { name: "Event form" }).getByRole("tab", { name: "Raw JSON" }).click();
  await expect(editor).toHaveValue(/"m.room.message"/);
  await host.story("sidepanel-devbackendview--timeline-raw-json");

  await editor.fill('{ "type": "m.room.message", ');
  await form.getByRole("button", { name: "Send" }).click();
  await expect(form.getByRole("alert")).toContainText("Invalid JSON");
  await editor.fill('{ "type": "m.room.message" }');
  await form.getByRole("button", { name: "Send" }).click();
  await expect(form.getByRole("alert")).toHaveText('The event needs a "content" object.');
  expect((await host.store(LAB)).timeline).toHaveLength(count);

  await editor.fill('{ "type": "m.room.message", "sender": "@carol:dev.local", "content": { "msgtype": "m.emote", "body": "waves" } }');
  await form.getByRole("button", { name: "Send" }).click();
  await expect(form.getByRole("alert")).toHaveCount(0);
  await expect.poll(() => last(host)).toMatchObject({ eventType: "m.room.message", sender: "@carol:dev.local", content: { msgtype: "m.emote", body: "waves" } });
  await expect.poll(() => forwards(host)).toBe(forwarded + 1);
});

test("delayed event: it is listed under “Scheduled”; “Cancel” drops it and “Send now” sends it", async ({ host }) => {
  const view = host.page.getByTestId("devbackend-view");
  const form = view.getByRole("form", { name: "Send event" });
  const scheduled = view.getByRole("list", { name: "Scheduled events" }).getByRole("listitem");
  const count = (await host.store(LAB)).timeline.length;
  const forwarded = await forwards(host);

  await form.getByLabel("Body").fill("See you later");
  await form.getByRole("switch", { name: "Send delayed" }).check();
  await form.getByLabel("Delay in milliseconds").fill("60000");
  await form.getByRole("button", { name: "Schedule" }).click();
  await form.getByLabel("Body").fill("Never sent");
  await form.getByRole("button", { name: "Schedule" }).click();
  await expect(scheduled).toHaveCount(2);
  await expect(scheduled.first()).toContainText("m.room.message");
  await expect(scheduled.first()).toContainText(/in \d+\.\d s/);
  expect((await host.store(LAB)).delayed).toHaveLength(2);
  expect((await host.store(LAB)).timeline).toHaveLength(count);
  await host.story("sidepanel-devbackendview--timeline-delayed");

  await scheduled.last().getByRole("button", { name: "Cancel" }).click();
  await expect(scheduled).toHaveCount(1);
  await scheduled.first().getByRole("button", { name: "Restart" }).click();
  await expect(scheduled.first()).toContainText("1 restart");
  await scheduled.first().getByRole("button", { name: "Send now" }).click();
  await expect(scheduled).toHaveCount(0);
  const timeline = (await host.store(LAB)).timeline as TimelineEvent[];
  expect(timeline).toHaveLength(count + 1);
  expect(timeline.at(-1)).toMatchObject({ eventType: "m.room.message", content: { body: "See you later" } });
  await expect.poll(() => forwards(host)).toBe(forwarded + 1);
});

test("a delayed event of another sender is refused", async ({ host }) => {
  const form = host.page.getByTestId("devbackend-view").getByRole("form", { name: "Send event" });
  await form.getByLabel("Sender").fill("@bob:dev.local");
  await form.getByLabel("Body").fill("Not mine");
  await form.getByRole("switch", { name: "Send delayed" }).check();
  await form.getByRole("button", { name: "Schedule" }).click();
  await expect(host.page.getByTestId("toast")).toContainText("a delayed event is always sent by @alice:dev.local");
  expect((await host.store(LAB)).delayed).toHaveLength(0);
});
