/**
 * The Timeline tab on the matrix-rust-sdk timeline (`room.timeline()`): edits, reactions and
 * redactions folded into their event, local echoes with their send state, display names and
 * avatars, images, why an event could not be decrypted. The
 * diffs are applied as in Aurora's `TimelineViewModel` (element-hq/aurora).
 */
import type { EventSendState, TimelineItem } from "@element-hq/web-shared-components";
import {
  DateDividerMode,
  EncryptedMessage,
  EventSendState_Tags,
  MessageFormat,
  MessageType,
  MsgLikeKind,
  PaginationStatus_Tags,
  ProfileDetails,
  TimelineDiff_Tags,
  TimelineFilter,
  TimelineFocus,
  TimelineItemContent,
  TimelineReadReceiptTracking,
  UtdCause,
  messageEventContentFromMarkdown,
  VirtualTimelineItem,
  type EventTimelineItem,
  type MediaSourceLike,
  type TaskHandleLike,
  type TimelineDiff,
  type TimelineConfiguration,
  type TimelineItemLike,
  type TimelineLike,
} from "matrix-sdk-uniffi-js";

import { LOADING_OLDER, OLDER_EVENTS_PER_LOAD } from "../../appViewModel";
import type { RawEvent, RoomTimelineViewModel, TimelineBody, TimelineRow } from "../../session";
import { timelineStore } from "../timelineViewModel";

/** Free an SDK object now (its `*Like` interface does not list `uniffiDestroy`; the objects of the bindings have it). */
const free = (object: object) => (object as { uniffiDestroy?(): void }).uniffiDestroy?.();

/** `items` with `diff` applied (a `VectorDiff` of the SDK). */
export function applyDiff<T>(items: T[], diff: TimelineDiff, parse: (item: TimelineItemLike) => T): T[] {
  switch (diff.tag) {
    case TimelineDiff_Tags.Append:
      return [...items, ...diff.inner.values.map(parse)];
    case TimelineDiff_Tags.Clear:
      return [];
    case TimelineDiff_Tags.PushFront:
      return [parse(diff.inner.value), ...items];
    case TimelineDiff_Tags.PushBack:
      return [...items, parse(diff.inner.value)];
    case TimelineDiff_Tags.PopFront:
      return items.slice(1);
    case TimelineDiff_Tags.PopBack:
      return items.slice(0, -1);
    case TimelineDiff_Tags.Insert:
      return [...items.slice(0, diff.inner.index), parse(diff.inner.value), ...items.slice(diff.inner.index)];
    case TimelineDiff_Tags.Set:
      return Object.assign([...items], { [diff.inner.index]: parse(diff.inner.value) });
    case TimelineDiff_Tags.Remove:
      return [...items.slice(0, diff.inner.index), ...items.slice(diff.inner.index + 1)];
    case TimelineDiff_Tags.Truncate:
      return items.slice(0, diff.inner.length);
    case TimelineDiff_Tags.Reset:
      return diff.inner.values.map(parse);
  }
}

const SEND_STATE: Record<EventSendState_Tags, EventSendState> = { NotSentYet: "sending", SendingFailed: "failed", Sent: "sent" };

/** The shared components' `DecryptionFailureReason` of a UTD cause (`UNABLE_TO_DECRYPT` for the rest). */
const UTD_REASONS: Partial<Record<UtdCause, string>> = {
  [UtdCause.SentBeforeWeJoined]: "HISTORICAL_MESSAGE_USER_NOT_JOINED",
  [UtdCause.VerificationViolation]: "SENDER_IDENTITY_PREVIOUSLY_VERIFIED",
  [UtdCause.UnsignedDevice]: "UNSIGNED_SENDER_DEVICE",
  [UtdCause.UnknownDevice]: "UNSIGNED_SENDER_DEVICE",
  [UtdCause.HistoricalMessageAndBackupIsDisabled]: "HISTORICAL_MESSAGE_BACKUP_UNCONFIGURED",
  [UtdCause.HistoricalMessageAndDeviceIsUnverified]: "HISTORICAL_MESSAGE_NO_KEY_BACKUP",
  [UtdCause.WithheldForUnverifiedOrInsecureDevice]: "MEGOLM_KEY_WITHHELD_FOR_UNVERIFIED_DEVICE",
};

/** What the SDK made of an event, as a tile body. */
function bodyOf(event: EventTimelineItem, media: (source: MediaSourceLike) => Promise<string | undefined>): TimelineBody {
  if (!TimelineItemContent.MsgLike.instanceOf(event.content)) return { kind: "event" };
  const { kind } = event.content.inner.content;
  if (MsgLikeKind.Redacted.instanceOf(kind)) return { kind: "redacted", reason: event.redactionReason };
  if (MsgLikeKind.UnableToDecrypt.instanceOf(kind)) {
    const { msg } = kind.inner;
    return { kind: "utd", reason: (EncryptedMessage.MegolmV1AesSha2.instanceOf(msg) && UTD_REASONS[msg.inner.cause]) || "UNABLE_TO_DECRYPT" };
  }
  if (!MsgLikeKind.Message.instanceOf(kind)) return { kind: "event" };
  const { msgType, body, isEdited } = kind.inner.content;
  if (MessageType.Image.instanceOf(msgType)) {
    const { caption, filename, source, info } = msgType.inner.content;
    const size = (n?: bigint) => (n === undefined ? undefined : Number(n));
    return { kind: "image", caption: caption ?? filename, width: size(info?.width), height: size(info?.height), load: () => media(source) };
  }
  const formatted = MessageType.Text.instanceOf(msgType) || MessageType.Notice.instanceOf(msgType) || MessageType.Emote.instanceOf(msgType) ? msgType.inner.content.formatted : undefined;
  const html = formatted && MessageFormat.Html.instanceOf(formatted.format) ? formatted.body : undefined;
  return { kind: "text", text: body, ...(html === undefined ? {} : { html }), edited: isEdited };
}

/** Turns the SDK's timeline items into the `TimelineView`'s; undefined for the virtual items it has no use for (read marker, start). */
function itemMapper(timeline: Promise<TimelineLike>, userId: string, media: (source: MediaSourceLike) => Promise<string | undefined>) {
  return (item: TimelineItemLike): TimelineItem | undefined => {
    const key = item.uniqueId().id;
    const virtual = item.asVirtual();
    if (virtual) return VirtualTimelineItem.DateDivider.instanceOf(virtual) ? { kind: "date-separator", key, ts: Number(virtual.inner.ts) } : undefined;
    const event = item.asEvent();
    if (!event) return undefined;
    const profile = ProfileDetails.Ready.instanceOf(event.senderProfile) ? event.senderProfile.inner : undefined;
    /** `null`: not read yet (the SDK serialises it on request). */
    let json: RawEvent | undefined | null = null;
    const row: TimelineRow = {
      sender: event.sender,
      name: profile?.displayName,
      avatar: profile?.avatarUrl,
      ts: Number(event.timestamp),
      body: bodyOf(event, media),
      reactions: event.reactions.map(({ key, senders }) => ({ key, senders: senders.map((s) => s.senderId), mine: senders.some((s) => s.senderId === userId) })),
      toggleReaction: (reaction) => void timeline.then((t) => t.toggleReaction(event.eventOrTransactionId, reaction)).catch((e) => console.error("the reaction could not be sent", e)),
      json: () => {
        if (json === null) {
          const original = event.lazyProvider.debugInfo().originalJson;
          json = original ? (JSON.parse(original) as RawEvent) : undefined;
        }
        return json;
      },
      sendState: event.localSendState && SEND_STATE[event.localSendState.tag],
    };
    return { kind: "event", key, event: row, continuation: false, lastInSection: true };
  };
}

/** A message after a message of the same sender (on the same day): the tile leaves out avatar and sender (as Element Web). */
function grouped(items: TimelineItem[]): TimelineItem[] {
  return items.map((item, i) => {
    const before = items[i - 1];
    if (item.kind !== "event" || before?.kind !== "event") return item;
    const [row, last] = [item.event as TimelineRow, before.event as TimelineRow];
    return { ...item, continuation: row.sender === last.sender && row.body.kind !== "event" && last.body.kind !== "event" };
  });
}

/** The SDK timelines of the Timeline tabs, without read receipts and read marker: the tab shows neither, and tracking them reads the receipts of every loaded event from the store. */
export const timelineConfiguration = (): TimelineConfiguration => ({
  focus: new TimelineFocus.Live({ hideThreadedEvents: false }),
  filter: new TimelineFilter.All(),
  internalIdPrefix: undefined,
  dateDividerMode: DateDividerMode.Daily,
  trackReadReceipts: TimelineReadReceiptTracking.Disabled,
  reportUtds: false,
});

/** A room's SDK timeline, lent to one Timeline tab; `release` gives it back (once). */
export interface LentTimeline {
  timeline: Promise<TimelineLike>;
  release(): void;
}

/** How long a room's SDK timeline is kept after its last Timeline tab went: a tab closed and opened again, or moved, reuses it. */
export const KEEP_TIMELINE_MS = 60_000;

/**
 * One SDK timeline per room, shared by the room's Timeline tabs (each adds its own listener, which
 * starts with the current items). Opening one is the expensive part (finding `rust-timeline-open-cost`).
 * It is freed `keepMs` after the last tab gave it back: while it lives it holds the room's event cache in memory.
 */
// TODO-FINDING rust-timeline-open-cost - opening a timeline costs an IndexedDB read per event the room's event cache holds in memory (thread info, in matrix-sdk-ui); the raw event feed keeps the cache full.
export class SharedTimelines {
  private readonly rooms = new Map<string, { timeline: Promise<TimelineLike>; users: number; dropTimer?: ReturnType<typeof setTimeout> }>();

  constructor(
    private readonly open: (roomId: string) => Promise<TimelineLike>,
    private readonly keepMs = KEEP_TIMELINE_MS,
  ) {}

  take(roomId: string): LentTimeline {
    let entry = this.rooms.get(roomId);
    if (!entry) {
      const created = { timeline: this.open(roomId), users: 0 };
      // A timeline that could not be opened is not kept: the next tab tries again.
      created.timeline.catch(() => this.rooms.get(roomId) === created && this.rooms.delete(roomId));
      this.rooms.set(roomId, (entry = created));
    }
    const lent = entry;
    clearTimeout(lent.dropTimer);
    lent.users++;
    let released = false;
    return {
      timeline: lent.timeline,
      release: () => {
        if (released || --lent.users > 0) return void (released = true);
        released = true;
        lent.dropTimer = setTimeout(() => {
          if (this.rooms.get(roomId) !== lent || lent.users > 0) return;
          this.rooms.delete(roomId);
          lent.timeline.then(free).catch(() => {});
        }, this.keepMs);
      },
    };
  }

  /** Free every timeline now (the session ends). */
  clear(): void {
    for (const entry of this.rooms.values()) {
      clearTimeout(entry.dropTimer);
      entry.timeline.then(free).catch(() => {});
    }
    this.rooms.clear();
  }
}

/**
 * A Timeline tab on a room's SDK timeline (`lent`, from `SharedTimelines`). `userId`: the account
 * (its reactions are selected); `media` loads an image. `send` goes through the timeline's send
 * queue: a local echo at once.
 */
export function rustTimelineViewModel(lent: LentTimeline, userId: string, media: (source: MediaSourceLike) => Promise<string | undefined>): RoomTimelineViewModel {
  let items: (TimelineItem | undefined)[] = [];
  let paginating = false;
  let atStart = false;
  let stopped = false;
  const handles: TaskHandleLike[] = [];
  const show = () => vm.show(grouped([...(paginating ? [LOADING_OLDER] : []), ...items.filter((i) => i !== undefined)]));
  const { timeline } = lent;
  const toItem = itemMapper(timeline, userId, media);
  const vm = timelineStore(
    () => {
      if (paginating || atStart) return;
      timeline.then((t) => t.paginateBackwards(OLDER_EVENTS_PER_LOAD)).catch((e) => console.error("older events could not be loaded", e));
    },
    () => {
      stopped = true;
      handles.forEach((h) => (h.cancel(), free(h)));
      lent.release();
    },
  );
  const send = (body: string) => void timeline.then((t) => t.send(messageEventContentFromMarkdown(body))).catch((e) => console.error("the message could not be sent", e));
  void (async () => {
    try {
      const t = await timeline;
      const keep = (h: TaskHandleLike) => (stopped ? (h.cancel(), free(h)) : handles.push(h));
      keep(
        await t.addListener({
          onUpdate: (diffs) => {
            items = diffs.reduce((acc, diff) => applyDiff(acc, diff, toItem), items);
            show();
          },
        }),
      );
      keep(
        await t.subscribeToBackPaginationStatus({
          onUpdate: (status) => {
            paginating = status.tag === PaginationStatus_Tags.Paginating;
            if (status.tag === PaginationStatus_Tags.Idle) atStart = status.inner.hitTimelineStart;
            show();
          },
        }),
      );
    } catch (e) {
      console.error("the timeline could not be opened", e);
      vm.show([]);
    }
  })();
  return Object.assign(vm, { send });
}
