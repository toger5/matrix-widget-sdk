/** The RoomTimeline: the Timeline tab of a room panel (Element Web's TimelineView), its events (the DevBackend's), live updates, a long timeline. stories `rooms-roomtimeline--*`, `rooms-tabbar--timeline-active` */
import type { HostSeed } from "../src/app/controller";
import { expect, type Host, LAB, NEW_WIDGET, test, widgetId } from "./host";

const NEW = widgetId(LAB, NEW_WIDGET);
const timeline = (host: Host) => host.page.getByTestId("room-timeline");
/** The event tiles the TimelineView renders (it is virtualised: those in and near the view). */
const rows = (host: Host) => timeline(host).getByTestId("event-tile");
const scroller = (host: Host) => timeline(host).getByTestId("timeline-scroller");
/** The ids of the events the DevBackend holds for the room, oldest first. */
const storeIds = async (host: Host) => (await host.store(LAB)).timeline.map((event) => event.eventId as string);
const shownIds = (host: Host) => rows(host).evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.eventId));
const toTop = (host: Host) => scroller(host).evaluate((el) => el.scrollTo({ top: 0 }));

test("“Open timeline” adds the Timeline tab at the end; its tiles are the room's events, oldest first; pressing one shows its JSON", async ({ host }) => {
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

  // The events of the room in the order of the store, at the bottom the newest; the mocked room starts with its creation.
  const ids = await storeIds(host);
  await expect(rows(host).last()).toContainText(/@carol:dev\.local.*The landscape picture is in the media repository\..*m\.room\.message/);
  await expect(rows(host).last()).toBeInViewport();
  const shown = await shownIds(host);
  expect(ids.slice(-shown.length)).toEqual(shown);
  await expect(rows(host).last()).not.toHaveClass(/state/);
  const widgetAdded = rows(host).filter({ hasText: "added the widget New test widget" });
  await expect(widgetAdded).toContainText("m.widget");
  await host.story("rooms-tabbar--timeline-active");
  await host.story("rooms-roomtimeline--start");

  const last = rows(host).last();
  await last.getByRole("button", { expanded: false }).click();
  await expect(last.getByRole("button", { expanded: true })).toBeVisible();
  await expect(last.locator("pre.code")).toContainText(`"event_id": "${ids.at(-1)}"`);
  await expect(last.locator("pre.code")).toContainText(`"body": "The landscape picture is in the media repository."`);
  await last.getByRole("button", { expanded: true }).click();
  await expect(last.locator("pre.code")).toHaveCount(0);

  // At the top: the room's creation, a muted state event, under a date separator.
  await toTop(host);
  await expect(rows(host).first()).toContainText("created the room");
  await expect(rows(host).first()).toHaveClass(/state/);
  await expect(timeline(host).getByRole("separator", { name: "Today" })).toBeVisible();

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
  await expect(rows(host).last()).toContainText("The landscape picture is in the media repository.");

  await host.frame(NEW).getByRole("button", { name: "send m.room.message" }).click();
  await expect(rows(host).last()).toContainText(/@alice:dev\.local.*hello from the new widget.*m\.room\.message/);
  await expect(rows(host).last()).toHaveAttribute("data-event-id", (await storeIds(host)).at(-1)!);

  const view = host.page.getByTestId("devbackend-view");
  await view.getByRole("button", { name: "Send event", exact: true }).click();
  const form = view.getByRole("form", { name: "Send event" });
  await form.getByLabel("Sender").fill("@bob:dev.local");
  await form.getByLabel("Body").fill("Hello from the DevBackendView");
  await form.getByRole("button", { name: "Send" }).click();
  await expect(rows(host).last()).toContainText(/@bob:dev\.local.*Hello from the DevBackendView/);
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

test("250 events: virtualised, it starts at the bottom and stays there while events arrive; the top is the start of the room", async ({ host }) => {
  await host.populate(manyMessages(250));
  await expect(rows(host).last()).toContainText("message 250");
  await expect(rows(host).last()).toBeInViewport();
  expect(await rows(host).count()).toBeLessThan(100);

  await send(host, "live 1");
  await expect(rows(host).last()).toContainText("live 1");
  await expect(rows(host).last()).toBeInViewport();
  // Same sender as the one before: the tile leaves the avatar and the sender out.
  await expect(rows(host).last().locator(".tl-c1, .tl-c2, .tl-c3, .tl-c4, .tl-c5, .tl-c6")).toHaveCount(1);
  await send(host, "live 2");
  await expect(rows(host).last()).toContainText("live 2");
  await expect(rows(host).last().locator(".tl-c1, .tl-c2, .tl-c3, .tl-c4, .tl-c5, .tl-c6")).toHaveCount(0);

  const anchor = rows(host).filter({ hasText: "message 248" });
  await anchor.getByRole("button").click();
  await expect(anchor.locator("pre.code")).toContainText('"body": "message 248"');
  await host.story("rooms-roomtimeline--events");

  await expect
    .poll(async () => {
      await toTop(host);
      return rows(host).first().textContent();
    })
    .toContain("created the room");
});

test("the composer sends a text message as the account; a message's HTML is shown, sanitised", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, open: [{ room: LAB, timeline: true }] });
  const input = host.page.getByRole("textbox", { name: "Message" });
  await expect(host.button("Send")).toBeDisabled();
  await input.fill("Hello from the composer");
  await input.press("Enter");
  await expect(rows(host).last()).toContainText("Hello from the composer");
  await expect(input).toHaveValue("");
  const sent = (await host.store(LAB)).timeline.at(-1)!;
  expect([sent.sender, sent.content]).toEqual(["@alice:dev.local", { msgtype: "m.text", body: "Hello from the composer" }]);

  const formatted = `<h2>Title</h2><b onclick="window.hacked = 1">bold</b><script>window.hacked = 1</script><a href="javascript:window.hacked = 1">bad</a> <a href="https://example.org/">good</a><img src="https://example.org/x.png"><mx-reply>quoted</mx-reply>`;
  await host.dispatch({ type: "roomTools/sendEvent", roomId: LAB, event: { type: "m.room.message", sender: "@bob:dev.local", content: { msgtype: "m.text", body: "Title bold", format: "org.matrix.custom.html", formatted_body: formatted } } });
  const tile = rows(host).last();
  await expect(tile.getByRole("heading", { name: "Title" })).toBeVisible();
  await expect(tile.locator("b")).toHaveText("bold");
  await expect(tile.locator("b")).not.toHaveAttribute("onclick");
  await expect(tile.locator("script, img, mx-reply")).toHaveCount(0);
  await expect(tile).not.toContainText("quoted");
  await expect(tile.getByText("bad")).not.toHaveAttribute("href");
  await expect(tile.getByRole("link", { name: "good" })).toHaveAttribute("href", "https://example.org/");
  await tile.getByRole("link", { name: "good" }).hover();
  expect(await host.page.evaluate(() => (window as unknown as { hacked?: number }).hacked)).toBeUndefined();
});

test("the Timeline tab opens at the newest event every time, also after it was scrolled up", async ({ host }) => {
  await host.populate(manyMessages(250));
  await expect(rows(host).last()).toContainText("message 250");
  const fromBottom = () => scroller(host).evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  const panelId = (await host.main()).workspaces[(await host.main()).activeAccountId].roomsArea.panels[0].id;
  for (const distance of [3000, 800]) {
    // With the wheel, as a user scrolls (it also ends the opening's hold on the bottom).
    await scroller(host).hover();
    await host.page.mouse.wheel(0, -distance);
    await expect.poll(fromBottom).toBeGreaterThan(500);
    await host.dispatch({ type: "tab/showOverview", panelId });
    await host.dispatch({ type: "tab/openTimeline", panelId });
    await expect(rows(host).last()).toContainText("message 250");
    await expect.poll(fromBottom).toBeLessThan(2);
  }
});
