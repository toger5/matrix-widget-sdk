/** The view models of the Timeline tab: the raw one (js session, DevBackend) and the rust one on the SDK timeline (faked). */
import type { TimelineItem } from "@element-hq/web-shared-components";
import { TimelineReadReceiptTracking } from "matrix-sdk-uniffi-js";
import { EncryptedMessage_Tags, EventSendState_Tags, MessageFormat_Tags, MessageType_Tags, MsgLikeKind_Tags, UtdCause, PaginationStatus_Tags, ProfileDetails_Tags, TimelineDiff_Tags, TimelineItemContent_Tags, VirtualTimelineItem_Tags, type RoomLike, type TimelineDiff, type TimelineItemLike } from "matrix-sdk-uniffi-js";
import { describe, expect, it, vi } from "vitest";

import { LOADING_OLDER, rawTimelineItems } from "../src/appViewModel";
import { rawTimelineViewModel } from "../src/matrix_session/timelineViewModel";
import { applyDiff, rustTimelineViewModel, SharedTimelines, timelineConfiguration } from "../src/matrix_session/rust/timelineViewModel";
import type { RawEvent, RoomTimeline, TimelineRow } from "../src/session";

const DAY = 86_400_000;
const T0 = new Date(2026, 10, 16, 12).getTime();
const ev = (id: string, sender: string, ts: number): RawEvent => ({ event_id: id, type: "m.room.message", sender, origin_server_ts: ts, content: { body: id } });
const shape = (items: TimelineItem[]) => items.map((i) => (i.kind === "event" ? `${i.key}${i.continuation ? "+" : ""}` : i.kind));
const flush = () => new Promise((resolve) => setTimeout(resolve));

describe("rawTimelineItems", () => {
  it("a date separator per day, one row per event; the same sender again on the same day continues", () => {
    const events = [ev("$1", "@a", T0), ev("$2", "@a", T0 + 1), ev("$3", "@b", T0 + 2), ev("$4", "@b", T0 + DAY)];
    const items = rawTimelineItems({ events, atStart: true, loadingOlder: false });
    expect(shape(items)).toEqual(["date-separator", "$1", "$2+", "$3", "date-separator", "$4"]);
    const row = (items[1] as { event: TimelineRow }).event;
    expect([row.sender, row.ts, row.json()]).toEqual(["@a", T0, events[0]]);
    expect(rawTimelineItems({ events, atStart: false, loadingOlder: true })[0]).toBe(LOADING_OLDER);
  });

  it("reactions are buttons on the event they react to (the account's selected); images, undecryptable and deleted events", async () => {
    const react = (sender: string, key: string, target = "$1"): RawEvent => ({ event_id: `$r${sender}${key}`, type: "m.reaction", sender, origin_server_ts: T0, content: { "m.relates_to": { rel_type: "m.annotation", event_id: target, key } } });
    const events: RawEvent[] = [
      ev("$1", "@a", T0),
      react("@a", "👍"),
      react("@b", "👍"),
      react("@b", "🎉"),
      react("@b", "👀", "$gone"),
      { event_id: "$img", type: "m.room.message", sender: "@a", origin_server_ts: T0, content: { msgtype: "m.image", body: "pic.png", url: "mxc://x/pic", info: { w: 4, h: 3 } } },
      { event_id: "$utd", type: "m.room.encrypted", sender: "@a", origin_server_ts: T0, content: {} },
      { event_id: "$del", type: "m.room.message", sender: "@a", origin_server_ts: T0, content: {}, unsigned: { redacted_because: {} } },
    ];
    const items = rawTimelineItems({ events, atStart: true, loadingOlder: false }, "@a", async (mxc) => `blob:${mxc}`);
    // the reaction to an event that is not loaded keeps its tile
    expect(shape(items)).toEqual(["date-separator", "$1", "$r@b👀", "$img", "$utd+", "$del+"]);
    const rows = items.flatMap((i) => (i.kind === "event" ? [i.event as TimelineRow] : []));
    expect(rows[0].reactions).toEqual([
      { key: "👍", senders: ["@a", "@b"], mine: true },
      { key: "🎉", senders: ["@b"], mine: false },
    ]);
    expect(rows[0].body).toEqual({ kind: "text", text: "$1" });
    const image = rows[2].body;
    expect(image).toMatchObject({ kind: "image", caption: "pic.png", width: 4, height: 3 });
    expect(image.kind === "image" && (await image.load())).toBe("blob:mxc://x/pic");
    expect([rows[3].body, rows[4].body]).toEqual([{ kind: "utd" }, { kind: "redacted" }]);
  });
});

describe("rawTimelineViewModel", () => {
  it("shows the session's timeline, reads it again on a change, loads older events at the top until the start, stops on dispose", async () => {
    let timeline: RoomTimeline = { events: [ev("$1", "@a", T0)], atStart: false, loadingOlder: false };
    let changed = () => {};
    const stop = vi.fn();
    const session = {
      userId: "@a",
      avatar: async () => undefined,
      timeline: vi.fn(async () => timeline),
      loadOlderEvents: vi.fn(async () => {}),
      onTimelineChanged: (_: string, listener: () => void) => ((changed = listener), stop),
    };
    const vm = rawTimelineViewModel(session, "!r");
    expect(vm.getSnapshot().items).toEqual([]);
    await flush();
    expect(shape(vm.getSnapshot().items)).toEqual(["date-separator", "$1"]);

    vm.onAnchorReached();
    expect(session.loadOlderEvents).toHaveBeenCalledWith("!r", 50);
    timeline = { events: [ev("$0", "@a", T0 - 1), ...timeline.events], atStart: true, loadingOlder: false };
    const listener = vi.fn();
    vm.subscribe(listener);
    changed();
    await flush();
    expect(listener).toHaveBeenCalled();
    expect(shape(vm.getSnapshot().items)).toEqual(["date-separator", "$0", "$1+"]);
    vm.onStartReached();
    expect(session.loadOlderEvents).toHaveBeenCalledTimes(1);

    vm.dispose();
    expect(stop).toHaveBeenCalled();
  });
});

const msgLike = (kind: unknown) => ({ tag: TimelineItemContent_Tags.MsgLike, inner: { content: { kind } } });
/** A fake SDK timeline item: the bindings' enums are tagged objects (`instanceOf` compares the tag). */
const message = (id: string, sender: string, body: string, more: Record<string, unknown> = {}) =>
  ({
    uniqueId: () => ({ id }),
    asVirtual: () => undefined,
    asEvent: () => ({
      sender,
      senderProfile: { tag: ProfileDetails_Tags.Ready, inner: { displayName: sender.slice(1).toUpperCase(), displayNameAmbiguous: false } },
      timestamp: BigInt(T0),
      reactions: [],
      content: msgLike({ tag: MsgLikeKind_Tags.Message, inner: { content: { body, isEdited: false, msgType: { tag: MessageType_Tags.Text, inner: { content: { body } } } } } }),
      lazyProvider: { debugInfo: () => ({ model: "", originalJson: JSON.stringify({ event_id: id, type: "m.room.message", content: { body } }) }) },
      ...more,
    }),
  }) as unknown as TimelineItemLike;
const divider = (id: string) => ({ uniqueId: () => ({ id }), asEvent: () => undefined, asVirtual: () => ({ tag: VirtualTimelineItem_Tags.DateDivider, inner: { ts: BigInt(T0) } }) }) as unknown as TimelineItemLike;
const diff = (tag: TimelineDiff_Tags, inner?: unknown) => ({ tag, inner }) as unknown as TimelineDiff;

describe("applyDiff", () => {
  it("applies every VectorDiff of the SDK", () => {
    const id = (item: TimelineItemLike) => item.uniqueId().id;
    const steps: [TimelineDiff, string[]][] = [
      [diff(TimelineDiff_Tags.Reset, { values: [message("a", "@x", ""), message("b", "@x", "")] }), ["a", "b"]],
      [diff(TimelineDiff_Tags.PushBack, { value: message("c", "@x", "") }), ["a", "b", "c"]],
      [diff(TimelineDiff_Tags.PushFront, { value: message("z", "@x", "") }), ["z", "a", "b", "c"]],
      [diff(TimelineDiff_Tags.Insert, { index: 1, value: message("y", "@x", "") }), ["z", "y", "a", "b", "c"]],
      [diff(TimelineDiff_Tags.Set, { index: 2, value: message("A", "@x", "") }), ["z", "y", "A", "b", "c"]],
      [diff(TimelineDiff_Tags.Remove, { index: 1 }), ["z", "A", "b", "c"]],
      [diff(TimelineDiff_Tags.PopFront), ["A", "b", "c"]],
      [diff(TimelineDiff_Tags.PopBack), ["A", "b"]],
      [diff(TimelineDiff_Tags.Append, { values: [message("d", "@x", "")] }), ["A", "b", "d"]],
      [diff(TimelineDiff_Tags.Truncate, { length: 1 }), ["A"]],
      [diff(TimelineDiff_Tags.Clear), []],
    ];
    let items: string[] = [];
    for (const [d, expected] of steps) expect((items = applyDiff(items, d, id))).toEqual(expected);
  });
});

describe("rustTimelineViewModel", () => {
  it("shows the SDK timeline: date dividers, messages with the display name, local echoes; paginates at the top until the start", async () => {
    let listener: { onUpdate(diffs: TimelineDiff[]): void } | undefined;
    let pagination: { onUpdate(status: unknown): void } | undefined;
    const cancel = vi.fn();
    const timeline = {
      addListener: async (l: typeof listener) => ((listener = l), { cancel }),
      subscribeToBackPaginationStatus: async (l: typeof pagination) => ((pagination = l), { cancel }),
      paginateBackwards: vi.fn(async () => false),
      toggleReaction: vi.fn(async () => true),
      uniffiDestroy: vi.fn(),
    };
    const timelineWithConfiguration = vi.fn(async (_: unknown) => timeline);
    const room = { timelineWithConfiguration } as unknown as RoomLike;
    const media = vi.fn(async (source: { url(): string }) => `blob:${source.url()}`);
    const release = vi.fn();
    const vm = rustTimelineViewModel({ timeline: room.timelineWithConfiguration(timelineConfiguration()), release }, "@ada", media);
    await flush();

    const echo = { localSendState: { tag: EventSendState_Tags.NotSentYet }, lazyProvider: { debugInfo: () => ({ model: "" }) } };
    const reactions = { reactions: [{ key: "👍", senders: [{ senderId: "@ada" }, { senderId: "@bob" }] }], eventOrTransactionId: "$1-id" };
    const source = { url: () => "mxc://x/pic" };
    const image = { content: msgLike({ tag: MsgLikeKind_Tags.Message, inner: { content: { body: "pic.png", isEdited: false, msgType: { tag: MessageType_Tags.Image, inner: { content: { filename: "pic.png", source, info: { width: 4n, height: 3n } } } } } } }) };
    const utd = { content: msgLike({ tag: MsgLikeKind_Tags.UnableToDecrypt, inner: { msg: { tag: EncryptedMessage_Tags.MegolmV1AesSha2, inner: { sessionId: "s", cause: UtdCause.SentBeforeWeJoined } } } }) };
    const deleted = { content: msgLike({ tag: MsgLikeKind_Tags.Redacted }), redactionReason: "spam" };
    const formatted = { body: "<b>bold</b>", format: { tag: MessageFormat_Tags.Html } };
    const rich = { content: msgLike({ tag: MsgLikeKind_Tags.Message, inner: { content: { body: "bold", isEdited: true, msgType: { tag: MessageType_Tags.Text, inner: { content: { body: "bold", formatted } } } } } }) };
    listener!.onUpdate([
      diff(TimelineDiff_Tags.Reset, { values: [divider("d"), message("$1", "@ada", "hi", reactions), message("$2", "@ada", "again")] }),
      diff(TimelineDiff_Tags.PushBack, { value: message("t1", "@ada", "sending", echo) }),
    ]);
    const items = vm.getSnapshot().items;
    expect(shape(items)).toEqual(["date-separator", "$1", "$2+", "t1+"]);
    const [, first, , sending] = items.map((i) => (i.kind === "event" ? (i.event as TimelineRow) : undefined));
    expect([first?.name, first?.body, first?.json()?.event_id]).toEqual(["ADA", { kind: "text", text: "hi", edited: false }, "$1"]);
    expect([sending?.sendState, sending?.json()]).toEqual(["sending", undefined]);
    expect(first?.reactions).toEqual([{ key: "👍", senders: ["@ada", "@bob"], mine: true }]);
    first?.toggleReaction?.("👍");
    await flush();
    expect(timeline.toggleReaction).toHaveBeenCalledWith("$1-id", "👍");

    listener!.onUpdate([diff(TimelineDiff_Tags.Append, { values: [message("$3", "@bob", "", image), message("$4", "@bob", "", utd), message("$5", "@bob", "", deleted), message("$6", "@bob", "", rich)] })]);
    const [img, undecryptable, redacted, html] = vm.getSnapshot().items.slice(-4).map((i) => (i as { event: TimelineRow }).event.body);
    expect(html).toEqual({ kind: "text", text: "bold", html: "<b>bold</b>", edited: true });
    expect(img).toMatchObject({ kind: "image", caption: "pic.png", width: 4, height: 3 });
    expect(img.kind === "image" && (await img.load())).toBe("blob:mxc://x/pic");
    expect([undecryptable, redacted]).toEqual([{ kind: "utd", reason: "HISTORICAL_MESSAGE_USER_NOT_JOINED" }, { kind: "redacted", reason: "spam" }]);

    // Once the TimelineView shows its first rows (they may not fill it, so it would never report the top).
    vm.onAnchorReached();
    await flush();
    expect(timeline.paginateBackwards).toHaveBeenCalledWith(50);
    pagination!.onUpdate({ tag: PaginationStatus_Tags.Paginating });
    expect(vm.getSnapshot().items[0]).toBe(LOADING_OLDER);
    vm.onStartReached();
    pagination!.onUpdate({ tag: PaginationStatus_Tags.Idle, inner: { hitTimelineStart: true } });
    expect(vm.getSnapshot().items[0].kind).toBe("date-separator");
    vm.onStartReached();
    await flush();
    expect(timeline.paginateBackwards).toHaveBeenCalledTimes(1);

    // No read receipts: tracking them reads the receipts of every loaded event.
    expect(timelineWithConfiguration.mock.calls[0][0]).toMatchObject({ trackReadReceipts: TimelineReadReceiptTracking.Disabled });
    vm.dispose();
    expect(cancel).toHaveBeenCalledTimes(2);
    // The SDK timeline is given back, not freed: other tabs of the room may use it (SharedTimelines frees it).
    expect(release).toHaveBeenCalledTimes(1);
    expect(timeline.uniffiDestroy).not.toHaveBeenCalled();
  });
});

describe("SharedTimelines", () => {
  const fakeTimeline = () => ({ uniffiDestroy: vi.fn() });
  const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("opens one SDK timeline per room for all its tabs; frees it a while after the last tab gave it back, unless a tab takes it again", async () => {
    const opened: ReturnType<typeof fakeTimeline>[] = [];
    const open = vi.fn(async (_: string) => (opened.push(fakeTimeline()), opened.at(-1)!) as never);
    const shared = new SharedTimelines(open, 20);
    const [a, b] = [shared.take("!r"), shared.take("!r")];
    expect(open).toHaveBeenCalledTimes(1);
    expect(await a.timeline).toBe(await b.timeline);
    a.release();
    a.release(); // once only
    await later(30);
    expect(opened[0].uniffiDestroy).not.toHaveBeenCalled(); // b still has it
    b.release();
    const c = shared.take("!r"); // within the time it is kept: the same one
    expect(open).toHaveBeenCalledTimes(1);
    c.release();
    await later(30);
    expect(opened[0].uniffiDestroy).toHaveBeenCalled();
    shared.take("!r");
    expect(open).toHaveBeenCalledTimes(2);
    shared.take("!other");
    shared.clear();
    await flush();
    expect(opened.slice(1).every((t) => t.uniffiDestroy.mock.calls.length === 1)).toBe(true);
  });

  it("does not keep a timeline that could not be opened", async () => {
    const open = vi.fn(async () => {
      throw new Error("unknown room");
    });
    const shared = new SharedTimelines(open, 20);
    await expect(shared.take("!r").timeline).rejects.toThrow("unknown room");
    await expect(shared.take("!r").timeline).rejects.toThrow();
    expect(open).toHaveBeenCalledTimes(2);
  });
});
