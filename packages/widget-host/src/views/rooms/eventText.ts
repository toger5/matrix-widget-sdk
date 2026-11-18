/**
 * What an event of the RoomTimeline says, in words. Pure
 * functions of the raw event JSON; the sender, the time and the event type are shown next to it.
 * Nothing is hidden or merged: an edit, a reaction, an undecryptable or a deleted event gets its own line.
 */
import type { RawEvent } from "../../session";
import { WIDGET_EVENT_TYPES } from "../../widgetStateEvent";
import { previewOf } from "../helpers";
import type { IconName } from "../ui/icons";

export interface EventDescription {
  /** What happened, in words. */
  text: string;
  /** Shown before the text. */
  icon?: IconName;
  /** `text` is a preview of the content (an event type without a description): monospace. */
  mono?: boolean;
  /** A state event: its line is muted. */
  state: boolean;
}

const asObject = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const asString = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

/** The RTC member event types: MSC3401 (a state event per device) and MSC4143 (a timeline event). */
const RTC_MEMBER_TYPES = ["org.matrix.msc3401.call.member", "org.matrix.msc4143.rtc.member"];

/** At most this many characters of `text` (the line ellipsises it anyway; an event body may be 64 KB). */
const MAX_TEXT = 300;

const MSGTYPES: Record<string, { label: string; icon: IconName }> = {
  "m.image": { label: "image", icon: "image" },
  "m.video": { label: "video", icon: "video" },
  "m.audio": { label: "audio", icon: "audio" },
  "m.file": { label: "file", icon: "upload" },
  "m.location": { label: "location", icon: "globe" },
};

/** The noun of a deleted event: "Deleted message". */
const DELETED: Record<string, string> = { "m.room.message": "message", "m.sticker": "sticker", "m.reaction": "reaction", "m.room.encrypted": "message" };

/** `table[key]` for the keys the table has: an event's `constructor` or `__proto__` is not one. */
const lookup = <T>(table: Record<string, T>, key: string): T | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);

/** What `event` says, for its line of the RoomTimeline: plain text (the view never renders it as HTML), at most `MAX_TEXT` characters. */
export function describeEvent(event: RawEvent): EventDescription {
  const said = describe(event);
  if (said.text.length <= MAX_TEXT) return said;
  // Not between the two halves of a surrogate pair.
  const cut = said.text.slice(0, MAX_TEXT - 1).replace(/[\uD800-\uDBFF]$/, "");
  return { ...said, text: `${cut}…` };
}

/**
 * Whether an RTC member event says its device is in the call. It left with an empty event (MSC3401;
 * MSC4143 keeps the sticky key of MSC4354), `member.membership: "leave"` (MSC4143), or an empty
 * `memberships` list (MSC3401's first form: every device of a user in one event).
 */
function inCall(content: Record<string, unknown>): boolean {
  if (Object.keys(content).every((key) => key === "msc4354_sticky_key")) return false;
  if (Array.isArray(content.memberships)) return content.memberships.length > 0;
  return asObject(content.member).membership !== "leave";
}

function describe(event: RawEvent): EventDescription {
  const content = asObject(event.content);
  const stateKey = typeof event.state_key === "string" ? event.state_key : undefined;
  const state = stateKey !== undefined;
  const unsigned = asObject(event.unsigned);
  const said = (text: string, icon?: IconName): EventDescription => ({ text, ...(icon ? { icon } : {}), state });

  if (unsigned.redacted_because !== undefined) {
    return said(`Deleted ${lookup(DELETED, event.type) ?? (state ? `${event.type}${stateKey ? ` · ${stateKey}` : ""}` : "event")}`, "trash");
  }

  switch (event.type) {
    case "m.room.encrypted":
      return said("Unable to decrypt", "lock");
    case "m.room.redaction": {
      const redacts = asString(content.redacts) ?? asString(event.redacts);
      return said(redacts ? `deleted the event ${redacts}` : "deleted an event", "trash");
    }
    case "m.room.message":
      return message(content, state);
    case "m.sticker":
      return said(`sticker: ${asString(content.body) ?? "(no description)"}`, "image");
    case "m.reaction": {
      const key = asString(asObject(content["m.relates_to"]).key);
      return said(key ? `reacted ${key}` : "reacted", undefined);
    }
  }

  if (RTC_MEMBER_TYPES.includes(event.type)) {
    const device = asString(content.device_id) ?? asString(asObject(content.member).device_id);
    return said(`${inCall(content) ? "joined" : "left"} the call${device ? ` · device ${device}` : ""}`, "phone");
  }

  if (stateKey === undefined) {
    const preview = previewOf(content);
    return { text: preview, mono: preview.startsWith("{"), state };
  }
  // `prev_content` used to be next to the content; servers that still send it there may omit it in `unsigned`.
  return stateText(event.type, stateKey, content, asObject(unsigned.prev_content ?? event.prev_content), asString(event.sender));
}

/** An `m.room.message`, by its `msgtype`. */
function message(content: Record<string, unknown>, state: boolean): EventDescription {
  const relation = asObject(content["m.relates_to"]);
  const body = asString(content.body);
  if (relation.rel_type === "m.replace") {
    const replacement = asString(asObject(content["m.new_content"]).body) ?? body?.replace(/^\* /, "");
    return { text: `edited: ${replacement ?? "(no text)"}`, icon: "edit", state };
  }
  const msgtype = asString(content.msgtype);
  // matrix-js-sdk's stand-in for an event it could not decrypt (the session hands out the encrypted event instead).
  if (msgtype === "m.bad.encrypted") return { text: "Unable to decrypt", icon: "lock", state };
  const media = msgtype ? lookup(MSGTYPES, msgtype) : undefined;
  if (media) return { text: `${media.label}: ${body ?? "(no description)"}`, icon: media.icon, state };
  if (msgtype === "m.emote") return { text: `* ${body ?? ""}`, state };
  if (body !== undefined) return { text: body, state };
  const preview = previewOf(content);
  return { text: preview, mono: preview.startsWith("{"), state };
}

/** A state event: membership, the room's settings, widgets; any other type "set <type> · <state key>". */
function stateText(type: string, stateKey: string, content: Record<string, unknown>, previous: Record<string, unknown>, sender: string | undefined): EventDescription {
  const said = (text: string, icon?: IconName): EventDescription => ({ text, ...(icon ? { icon } : {}), state: true });
  if (WIDGET_EVENT_TYPES.includes(type)) {
    const name = asString(content.name) ?? asString(previous.name) ?? stateKey;
    if (asString(content.url) === undefined) return said(`removed the widget ${name}`, "grid");
    return said(`${asString(previous.url) === undefined ? "added" : "changed"} the widget ${name}`, "grid");
  }
  switch (type) {
    case "m.room.member":
      return said(membership(stateKey, content, previous, sender), "users");
    case "m.room.create":
      return said("created the room", "hash");
    case "m.room.name": {
      const name = asString(content.name);
      return said(name ? `named the room “${name}”` : "removed the room name", "edit");
    }
    case "m.room.topic": {
      const topic = asString(content.topic);
      return said(topic ? `changed the topic to “${topic}”` : "removed the topic", "edit");
    }
    case "m.room.avatar":
      return said(asString(content.url) ? "changed the room avatar" : "removed the room avatar", "image");
    case "m.room.power_levels":
      return said("changed the power levels", "shield");
    case "m.room.join_rules":
      return said(`set the join rule to ${asString(content.join_rule) ?? "(none)"}`, "shield");
    case "m.room.history_visibility":
      return said(`set the history visibility to ${asString(content.history_visibility) ?? "(none)"}`, "eye");
    case "m.room.guest_access":
      return said(`set guest access to ${asString(content.guest_access) ?? "(none)"}`, "shield");
    case "m.room.encryption":
      return said("turned on end-to-end encryption", "lock");
    case "m.room.canonical_alias": {
      const alias = asString(content.alias);
      return said(alias ? `set the main address to ${alias}` : "removed the main address", "hash");
    }
    case "m.room.pinned_events":
      return said("changed the pinned events", "pin");
    case "m.room.server_acl":
      return said("changed the server ACLs", "shield");
    case "m.room.tombstone":
      return said("upgraded the room", "arrowUpRight");
  }
  return said(stateKey ? `set ${type} · ${stateKey}` : `set ${type}`);
}

/** "joined the room", "invited @bob:example.org", … The sender is shown next to it. */
function membership(target: string, content: Record<string, unknown>, previous: Record<string, unknown>, sender: string | undefined): string {
  const now = asString(content.membership);
  const before = asString(previous.membership);
  const self = target === sender;
  switch (now) {
    case "join":
      if (before !== "join") return "joined the room";
      return asString(content.displayname) !== asString(previous.displayname) ? `changed their display name to ${asString(content.displayname) ?? "(none)"}` : "changed their profile";
    case "invite":
      return `invited ${target}`;
    case "leave":
      if (self) return before === "invite" ? "rejected the invitation" : before === "knock" ? "withdrew the request to join" : "left the room";
      if (before === "ban") return `unbanned ${target}`;
      if (before === "invite") return `withdrew the invitation of ${target}`;
      return `removed ${target}`;
    case "ban":
      return `banned ${target}`;
    case "knock":
      return "asked to join";
  }
  return `set the membership of ${target} to ${now ?? "(none)"}`;
}

// Made once: a formatter is expensive to create, and every line and day heading uses one.
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" });
const DAY_AND_YEAR = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** `ts` if it is a time a `Date` can hold (a formatter throws on any other; the sending server picks `origin_server_ts`). */
const valid = (ts: number): number | undefined => (Number.isFinite(ts) && Math.abs(ts) <= 8.64e15 ? ts : undefined);

/** "17:40:02": the local time of `ts` (ms since the epoch). Empty if it is not a valid time. */
export function timeLabel(ts: number): string {
  return valid(ts) === undefined ? "" : TIME.format(ts);
}

const keyOf = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** The local day of `ts`, for the date separators: "Today", "Yesterday", "Saturday 14 November" (with the year if it is not this one). */
export function dayLabel(ts: number, now = Date.now()): string {
  if (valid(ts) === undefined) return "Unknown date";
  const day = new Date(ts);
  const today = new Date(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (keyOf(day) === keyOf(today)) return "Today";
  if (keyOf(day) === keyOf(yesterday)) return "Yesterday";
  return (day.getFullYear() === today.getFullYear() ? DAY : DAY_AND_YEAR).format(day);
}
