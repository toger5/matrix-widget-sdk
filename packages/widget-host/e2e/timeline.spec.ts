/** The RoomTimeline: the Timeline tab of a room panel, its events (the DevBackend's), live updates, the newest 200 and the older ones. stories `rooms-roomtimeline--*`, `rooms-tabbar--timeline-active` */
import type { HostSeed } from "../src/app/controller";
import { expect, type Host, LAB, NEW_WIDGET, test, widgetId } from "./host";

const NEW = widgetId(LAB, NEW_WIDGET);
const timeline = (host: Host) => host.page.getByTestId("room-timeline");
const rows = (host: Host) => timeline(host).getByRole("listitem");
/** The ids of the events the DevBackend holds for the room, oldest first. */
const storeIds = async (host: Host) => (await host.store(LAB)).timeline.map((event) => event.eventId as string);
const shownIds = (host: Host) => rows(host).evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.eventId));

test("“Open timeline” adds the Timeline tab at the end; its lines are the room's events, oldest first; pressing one shows its JSON", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET], overview: true }] });
  const overview = host.page.getByTestId("room-overview");
  await overview.getByRole("button", { name: "Open timeline" }).click();

  await expect(host.page.getByRole("tab")).toHaveText([/Widget lab/, /New test widget/, /Timeline/]);
  const tab = host.tab("Timeline");
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(tab).toHaveAttribute("title", "Timeline of Widget lab");
  await expect(host.page.getByRole("tabpanel", { name: "Timeline" })).toBeVisible();
  // A host tab: a close button, but no dev tools button. The widget keeps running behind its tab.
  await expect(host.button("Close the timeline")).toHaveAttribute("title", "Close the timeline (Alt+W)");
  await expect(host.button(/^Dev tools of/)).toHaveCount(1);
  expect(Object.keys((await host.main()).widgets)).toEqual([NEW]);

  // Every event of the room, in the order of the store; the mocked room starts with its creation.
  await expect.poll(() => shownIds(host)).toEqual(await storeIds(host));
  await expect(timeline(host).getByText("Start of the room")).toBeVisible();
  await expect(timeline(host).getByRole("button", { name: "Load older events" })).toHaveCount(0);
  await expect(timeline(host).getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(rows(host).first()).toContainText("created the room");
  await expect(rows(host).first()).toHaveClass(/state/);
  const widgetAdded = rows(host).filter({ hasText: "added the widget New test widget" });
  await expect(widgetAdded).toContainText("m.widget");
  await expect(rows(host).last()).toContainText(/@carol:dev\.local\s*The landscape picture is in the media repository\.\s*m\.room\.message/);
  await expect(rows(host).last()).not.toHaveClass(/state/);
  await host.story("rooms-tabbar--timeline-active");
  await host.story("rooms-roomtimeline--start");

  const last = rows(host).last();
  const [lastId] = (await storeIds(host)).slice(-1);
  await last.getByRole("button", { expanded: false }).click();
  await expect(last.getByRole("button", { expanded: true })).toBeVisible();
  await expect(last.locator("pre.code")).toContainText(`"event_id": "${lastId}"`);
  await expect(last.locator("pre.code")).toContainText(`"body": "The landscape picture is in the media repository."`);
  await last.getByRole("button", { expanded: true }).click();
  await expect(last.locator("pre.code")).toHaveCount(0);

  // The overview offers the tab it has instead of a second one.
  await host.tab("Widget lab").click();
  await overview.getByRole("button", { name: "Show timeline" }).click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(host.page.getByRole("tab")).toHaveCount(3);
});

test("new events appear live: sent by a widget, and from the send form of the DevBackendView", async ({ host }) => {
  // The widget in one panel, the timeline of the same room in the other.
  await host.populate("lab", { behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET] }, { room: LAB, timeline: true }] });
  await host.ready(NEW);
  const count = (await storeIds(host)).length;
  await expect(rows(host)).toHaveCount(count);

  await host.frame(NEW).getByRole("button", { name: "send m.room.message" }).click();
  await expect(rows(host)).toHaveCount(count + 1);
  await expect(rows(host).last()).toContainText(/@alice:dev\.local\s*hello from the new widget\s*m\.room\.message/);
  expect(await shownIds(host)).toEqual(await storeIds(host));

  const form = host.page.getByTestId("devbackend-view").getByRole("form", { name: "Send event" });
  await form.getByLabel("Sender").fill("@bob:dev.local");
  await form.getByLabel("Body").fill("Hello from the DevBackendView");
  await form.getByRole("button", { name: "Send" }).click();
  await expect(rows(host)).toHaveCount(count + 2);
  await expect(rows(host).last()).toContainText(/@bob:dev\.local\s*Hello from the DevBackendView/);
  await expect(rows(host).last()).toBeInViewport();
});

/** The lab room with `n` more messages, its timeline open. */
const manyMessages = (n: number): HostSeed => ({
  userId: "@alice:dev.local",
  rooms: [
    {
      id: LAB,
      name: "Widget lab",
      timeline: Array.from({ length: n }, (_, i) => ({ type: "m.room.message", sender: "@bob:dev.local", content: { msgtype: "m.text", body: `message ${i + 1}` } })),
    },
  ],
  sidePanel: null,
  open: [{ room: LAB, timeline: true }],
});
const send = (host: Host, body: string) => host.dispatch({ type: "roomTools/sendEvent", roomId: LAB, event: { type: "m.room.message", sender: "@carol:dev.local", content: { msgtype: "m.text", body } } });

test("250 events: the newest 200 are shown, at the bottom; “Load older events” shows the rest and the start of the room. At the bottom it stays there, scrolled up the events in view stay put", async ({ host }) => {
  await host.populate(manyMessages(250));
  const ids = await storeIds(host);
  expect(ids.length).toBeGreaterThan(250);
  await expect(rows(host)).toHaveCount(200);
  expect(await shownIds(host)).toEqual(ids.slice(-200));
  await expect(rows(host).last()).toContainText("message 250");
  await expect(rows(host).last()).toBeInViewport();
  const older = timeline(host).getByRole("button", { name: "Load older events" });
  await expect(older).toBeAttached();
  await expect(timeline(host).getByText("Start of the room")).toHaveCount(0);

  // At the bottom: a new event is scrolled into view; the oldest rendered one makes room for it. The
  // other rows of its day stay as they are: a focused line keeps the focus.
  const focused = rows(host).filter({ has: host.page.getByText("message 250", { exact: true }) }).getByRole("button");
  await focused.focus();
  await send(host, "live 1");
  await expect(rows(host).last()).toContainText("live 1");
  await expect(rows(host).last()).toBeInViewport();
  await expect(rows(host)).toHaveCount(200);
  await expect(focused).toBeFocused();

  // Scrolled up: the events in view stay where they are, also when the oldest rendered one is dropped. The
  // browser reports a scroll with the next frame. An event may arrive before that (in the same task here, as
  // on a busy page): it neither pulls the timeline back to the bottom nor to where it was scrolled before.
  const anchor = rows(host).filter({ has: host.page.getByText("message 120", { exact: true }) });
  const steps = [
    ["start", "live 2", false], // away from the bottom, not reported yet
    ["center", "live 3", true], // reported
    ["start", "live 4", false], // scrolled up further, not reported yet
  ] as const;
  for (const [block, body, reported] of steps) {
    const before = await anchor.evaluate(
      async (row, { block, body, reported, roomId }) => {
        const scrolled = new Promise((resolve) => row.closest(".tl")!.addEventListener("scroll", resolve, { once: true }));
        row.scrollIntoView({ block });
        if (reported) await scrolled;
        const y = row.getBoundingClientRect().y;
        window.widgetHost!.dispatch({ type: "roomTools/sendEvent", roomId, event: { type: "m.room.message", sender: "@carol:dev.local", content: { msgtype: "m.text", body } } });
        return y;
      },
      { block, body, reported, roomId: LAB },
    );
    await expect(rows(host).last()).toContainText(body);
    await expect(rows(host).last()).not.toBeInViewport();
    expect(Math.abs((await anchor.boundingBox())!.y - before)).toBeLessThan(2);
  }

  await anchor.getByRole("button").click();
  await expect(anchor.locator("pre.code")).toContainText('"body": "message 120"');
  await anchor.evaluate((row) => row.scrollIntoView({ block: "center" }));
  await host.story("rooms-roomtimeline--events");

  // The loaded events that are not rendered first: here every event, so the start of the room is
  // reached. "Start of the room" replaces the button, and the focus moves on to the oldest event.
  await older.scrollIntoViewIfNeeded();
  const top = (await anchor.boundingBox())!.y;
  await older.focus();
  await host.page.keyboard.press("Enter");
  await expect(rows(host)).toHaveCount(ids.length + 4);
  await expect(timeline(host).getByText("Start of the room")).toBeAttached();
  await expect(older).toHaveCount(0);
  await expect(rows(host).first()).toContainText("created the room");
  await expect(rows(host).first().getByRole("button")).toBeFocused();
  // The older events appear above what was in view.
  expect(Math.abs((await anchor.boundingBox())!.y - top)).toBeLessThan(2);
  await timeline(host).evaluate((el) => (el.scrollTop = 0));
  await expect(timeline(host).getByText("Start of the room")).toBeInViewport();
});
