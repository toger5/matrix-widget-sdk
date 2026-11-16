/** What a line of the RoomTimeline says about an event (`src/views/rooms/eventText.ts`). */
import { describe, expect, it } from "vitest";

import type { RawEvent } from "../src/session";
import { dayKey, describeEvent, eventDay, eventTime } from "../src/views/rooms/eventText";
import { ROOM_TIMELINE } from "../src/views/fixtures";

const ev = (type: string, content: Record<string, unknown>, more: Partial<RawEvent> = {}): RawEvent => ({ type, sender: "@ada:example.org", content, ...more });
const state = (type: string, stateKey: string, content: Record<string, unknown>, more: Partial<RawEvent> = {}) => ev(type, content, { state_key: stateKey, ...more });

describe("describeEvent", () => {
  it("says what the events of story rooms-roomtimeline--events say", () => {
    expect(ROOM_TIMELINE.events.map((event) => describeEvent(event))).toEqual([
      { text: "joined the room", icon: "users", state: true },
      { text: "changed the topic to “Weekly critique of everything visual. Bring screenshots, leave opinions at the door.”", icon: "edit", state: true },
      { text: "added the widget Element Call", icon: "grid", state: true },
      { text: "Morning! The screenshots are on the whiteboard.", state: false },
      { text: "reacted 👍", state: false },
      { text: "Starting the call now", state: false },
      { text: "joined the call · device KJQWPLXBTA", icon: "phone", state: true },
      { text: "Unable to decrypt", icon: "lock", state: false },
      { text: "edited: The screenshots are on the whiteboard, page 2.", icon: "edit", state: false },
      { text: "Deleted message", icon: "trash", state: false },
      { text: "sticker: party parrot", icon: "image", state: false },
      { text: expect.stringMatching(/^\{"org\.matrix\.msc3381\.poll\.start":\{"question":\{"body":"Ship the new tab bar\?"\},.*…$/), mono: true, state: false },
    ]);
  });

  it("messages by msgtype", () => {
    expect(describeEvent(ev("m.room.message", { msgtype: "m.notice", body: "Build passed" }))).toEqual({ text: "Build passed", state: false });
    expect(describeEvent(ev("m.room.message", { msgtype: "m.emote", body: "waves" }))).toEqual({ text: "* waves", state: false });
    expect(describeEvent(ev("m.room.message", { msgtype: "m.image", body: "screenshot.png", url: "mxc://x/y" }))).toEqual({ text: "image: screenshot.png", icon: "image", state: false });
    expect(describeEvent(ev("m.room.message", { msgtype: "m.file", body: "notes.txt" }))).toMatchObject({ text: "file: notes.txt" });
    expect(describeEvent(ev("m.room.message", { msgtype: "m.bad.encrypted", body: "** Unable to decrypt **" }))).toEqual({ text: "Unable to decrypt", icon: "lock", state: false });
    // An edit without `m.new_content` falls back to the body, without its "* ".
    expect(describeEvent(ev("m.room.message", { body: "* fixed", "m.relates_to": { rel_type: "m.replace", event_id: "$1" } })).text).toBe("edited: fixed");
    expect(describeEvent(ev("m.room.message", { msgtype: "org.example.custom" }))).toEqual({ text: '{"msgtype":"org.example.custom"}', mono: true, state: false });
  });

  it("membership changes, from the sender's point of view", () => {
    const member = (target: string, membership: string, prev?: Record<string, unknown>, content: Record<string, unknown> = {}) =>
      describeEvent(state("m.room.member", target, { membership, ...content }, prev ? { unsigned: { prev_content: prev } } : {})).text;
    expect(member("@ada:example.org", "join")).toBe("joined the room");
    expect(member("@ada:example.org", "join", { membership: "join", displayname: "Ada" }, { displayname: "Ada O." })).toBe("changed their display name to Ada O.");
    expect(member("@ada:example.org", "join", { membership: "join", displayname: "Ada" }, { displayname: "Ada", avatar_url: "mxc://x/y" })).toBe("changed their profile");
    expect(member("@bob:example.org", "invite")).toBe("invited @bob:example.org");
    expect(member("@ada:example.org", "leave")).toBe("left the room");
    expect(member("@ada:example.org", "leave", { membership: "invite" })).toBe("rejected the invitation");
    expect(member("@bob:example.org", "leave")).toBe("removed @bob:example.org");
    expect(member("@bob:example.org", "leave", { membership: "invite" })).toBe("withdrew the invitation of @bob:example.org");
    expect(member("@bob:example.org", "leave", { membership: "ban" })).toBe("unbanned @bob:example.org");
    expect(member("@bob:example.org", "ban")).toBe("banned @bob:example.org");
    expect(member("@ada:example.org", "knock")).toBe("asked to join");
    // `prev_content` next to the content (older servers).
    expect(describeEvent(state("m.room.member", "@ada:example.org", { membership: "join", displayname: "Ada O." }, { prev_content: { membership: "join", displayname: "Ada" } })).text).toBe(
      "changed their display name to Ada O.",
    );
  });

  it("event content is only ever text, and a long one is cut", () => {
    const html = '<img src=x onerror="alert(1)">';
    expect(describeEvent(ev("m.room.message", { msgtype: "m.text", body: html })).text).toBe(html);
    const long = describeEvent(ev("m.room.message", { msgtype: "m.text", body: "a".repeat(298) + "😀".repeat(10) })).text;
    // Cut at 299 characters, which would split the first emoji: before it.
    expect(long).toBe(`${"a".repeat(298)}…`);
    expect(describeEvent(ev("m.room.message", { msgtype: "m.text", body: "b".repeat(5000) })).text).toBe(`${"b".repeat(299)}…`);
    expect(describeEvent(state("org.example.config", "k".repeat(1000), {})).text).toMatch(/^set org\.example\.config · k+…$/);
    // Keys of an object's prototype are not event types or msgtypes the timeline knows.
    expect(describeEvent(ev("constructor", {}, { unsigned: { redacted_because: {} } })).text).toBe("Deleted event");
    expect(describeEvent(ev("m.room.message", { msgtype: "constructor", body: "hi" })).text).toBe("hi");
  });

  it("room settings and widgets", () => {
    expect(describeEvent(state("m.room.create", "", { room_version: "11" }))).toEqual({ text: "created the room", icon: "hash", state: true });
    expect(describeEvent(state("m.room.name", "", { name: "Widget lab" })).text).toBe("named the room “Widget lab”");
    expect(describeEvent(state("m.room.name", "", {})).text).toBe("removed the room name");
    expect(describeEvent(state("m.room.topic", "", {})).text).toBe("removed the topic");
    expect(describeEvent(state("m.room.power_levels", "", { users: {} }))).toEqual({ text: "changed the power levels", icon: "shield", state: true });
    expect(describeEvent(state("m.room.join_rules", "", { join_rule: "invite" })).text).toBe("set the join rule to invite");
    expect(describeEvent(state("m.room.encryption", "", { algorithm: "m.megolm.v1.aes-sha2" })).text).toBe("turned on end-to-end encryption");

    const widget = { name: "Element Call", url: "https://call.example.org/" };
    expect(describeEvent(state("m.widget", "call", widget)).text).toBe("added the widget Element Call");
    expect(describeEvent(state("m.widget", "call", widget, { unsigned: { prev_content: widget } })).text).toBe("changed the widget Element Call");
    expect(describeEvent(state("im.vector.modular.widgets", "call", {}, { unsigned: { prev_content: widget } }))).toEqual({ text: "removed the widget Element Call", icon: "grid", state: true });
    expect(describeEvent(state("m.widget", "notes", {})).text).toBe("removed the widget notes");
  });

  it("RTC members join and leave a call; other state is “set <type> · <state key>”, other events a preview", () => {
    expect(describeEvent(ev("org.matrix.msc4143.rtc.member", { device_id: "ALICEDEV", application: "m.call" }))).toEqual({ text: "joined the call · device ALICEDEV", icon: "phone", state: false });
    expect(describeEvent(state("org.matrix.msc3401.call.member", "_@ada:example.org_KJQ", {}))).toEqual({ text: "left the call", icon: "phone", state: true });
    // MSC3401's first form: every device of a user in one event.
    expect(describeEvent(state("org.matrix.msc3401.call.member", "@ada:example.org", { memberships: [{ device_id: "KJQ" }] })).text).toBe("joined the call");
    expect(describeEvent(state("org.matrix.msc3401.call.member", "@ada:example.org", { memberships: [] })).text).toBe("left the call");
    // MSC4143: a member that leaves, and a withdrawn sticky event (MSC4354).
    const member = { id: "m1", user_id: "@ada:example.org", device_id: "ADADEV" };
    expect(describeEvent(ev("org.matrix.msc4143.rtc.member", { slot_id: "m.call#", member, application: { type: "m.call" } })).text).toBe("joined the call · device ADADEV");
    expect(describeEvent(ev("org.matrix.msc4143.rtc.member", { slot_id: "m.call#", member: { id: "m1", membership: "leave" }, leave_reason: { code: "lost" } })).text).toBe("left the call");
    expect(describeEvent(ev("org.matrix.msc4143.rtc.member", { msc4354_sticky_key: "m1" })).text).toBe("left the call");
    expect(describeEvent(state("org.example.config", "key", { a: 1 }))).toEqual({ text: "set org.example.config · key", state: true });
    expect(describeEvent(state("org.example.config", "", { a: 1 })).text).toBe("set org.example.config");
    expect(describeEvent(ev("org.example.ping", { seq: 1 }))).toEqual({ text: '{"seq":1}', mono: true, state: false });
    expect(describeEvent(ev("org.example.say", { body: "hi" }))).toEqual({ text: "“hi”", mono: false, state: false });
  });

  it("undecryptable, deleted and deleting events", () => {
    expect(describeEvent(ev("m.room.encrypted", { algorithm: "m.megolm.v1.aes-sha2" }))).toEqual({ text: "Unable to decrypt", icon: "lock", state: false });
    const redacted = { unsigned: { redacted_because: { type: "m.room.redaction" } } };
    expect(describeEvent(ev("m.reaction", {}, redacted)).text).toBe("Deleted reaction");
    expect(describeEvent(ev("org.example.ping", {}, redacted)).text).toBe("Deleted event");
    expect(describeEvent(state("m.room.topic", "", {}, redacted))).toEqual({ text: "Deleted m.room.topic", icon: "trash", state: true });
    expect(describeEvent(ev("m.room.redaction", { redacts: "$1" }))).toEqual({ text: "deleted the event $1", icon: "trash", state: false });
    // Before room version 11, `redacts` is next to the content.
    expect(describeEvent(ev("m.room.redaction", {}, { redacts: "$2" })).text).toBe("deleted the event $2");
  });
});

describe("eventTime and eventDay", () => {
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h, 4, 5).getTime();
  const now = at(2026, 10, 16, 15);

  it("the local time, and the day heading: Today, Yesterday, the date (with the year if it is not this one)", () => {
    expect(eventTime(ev("x", {}, { origin_server_ts: at(2026, 10, 16) }))).toBe("12:04:05");
    expect(eventTime(ev("x", {}, { origin_server_ts: at(2026, 10, 16, 9) }))).toBe("09:04:05");
    expect(eventTime(ev("x", {}))).toBe("");
    expect(eventDay(ev("x", {}, { origin_server_ts: at(2026, 10, 16, 0) }), now).label).toBe("Today");
    expect(eventDay(ev("x", {}, { origin_server_ts: at(2026, 10, 15, 23) }), now).label).toBe("Yesterday");
    expect(eventDay(ev("x", {}, { origin_server_ts: at(2026, 10, 14) }), now).label).toMatch(/^Saturday,? 14 November$/);
    expect(eventDay(ev("x", {}, { origin_server_ts: at(2025, 11, 31) }), now).label).toMatch(/^Wednesday,? 31 December 2025$/);
    expect(eventDay(ev("x", {}), now)).toEqual({ key: "", label: "Unknown date" });
    // Same day, same key: one heading.
    expect(eventDay(ev("x", {}, { origin_server_ts: at(2026, 10, 14, 1) }), now).key).toBe(eventDay(ev("x", {}, { origin_server_ts: at(2026, 10, 14, 23) }), now).key);
    expect(dayKey(ev("x", {}, { origin_server_ts: at(2026, 10, 14, 1) }))).toBe(eventDay(ev("x", {}, { origin_server_ts: at(2026, 10, 14, 23) }), now).key);
    expect(dayKey(ev("x", {}))).toBe("");
    // A time a Date cannot hold (the sending server picks it) is no time.
    const far = ev("x", {}, { origin_server_ts: 1e300 });
    expect([eventTime(far), dayKey(far), eventDay(far, now).label]).toEqual(["", "", "Unknown date"]);
  });
});
