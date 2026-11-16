/** The "Timeline" section of a mocked room (mockup functions `formChips`, `timelineSection`, `eventList`). leaves devbackend/timeline* */
import { useId, useState, type FormEvent } from "react";

import type { DevBackendViewModel, MockedRoomData, MockedTimelineEvent, RoomId } from "../../appViewModel";
import { useDispatch } from "../env";
import { Button, Field, Icon, Json, Toggle } from "../ui/atoms";
import { DelayRow, FormError, JsonArea, NO_DELAY, Sub, delayOf, parseJsonObject, pretty, previewOf, timeOf, useNow } from "./parts";

type SendForm = DevBackendViewModel["sendForm"];
type NewEvent = Pick<MockedTimelineEvent, "type" | "sender" | "content">;

const FORMS: { form: SendForm; label: string }[] = [
  { form: "message", label: "Message" },
  { form: "sticker", label: "Sticker" },
  { form: "rtcMember", label: "RTC member" },
  { form: "media", label: "Image / audio" },
  { form: "raw", label: "Raw JSON" },
];

/** How many events the list renders at first, and per "Show more". */
const PAGE = 100;

interface Props {
  roomId: RoomId;
  sendForm: SendForm;
  timeline: MockedTimelineEvent[];
  scheduled: MockedRoomData["scheduled"];
  /** The default sender. */
  userId?: string;
  /** Suggestions for the sender field. */
  members: string[];
}

export function TimelineSection({ roomId, sendForm, timeline, scheduled, userId = "", members }: Props) {
  const dispatch = useDispatch();
  const senders = useId();

  const [draft, setDraft] = useState(() => ({
    sender: userId,
    body: "",
    stickerBody: "",
    stickerUrl: "",
    rtcDeviceId: "",
    rtcJoined: true,
    msgtype: "m.image",
    mediaUrl: "",
    mediaBody: "",
    raw: pretty({ type: "m.room.message", sender: userId, content: { msgtype: "m.text", body: "" } }),
  }));
  const set = (patch: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...patch }));
  const [delay, setDelay] = useState(NO_DELAY);
  const [error, setError] = useState<string>();

  /** The event of the shown form, or what is wrong with the draft. */
  const build = (): NewEvent | string => {
    const sender = draft.sender.trim();
    const mxc = (url: string) => url.trim().startsWith("mxc://");
    if (sendForm === "raw") {
      const parsed = parseJsonObject(draft.raw);
      if ("error" in parsed) return parsed.error;
      const { type, sender: rawSender = userId, content } = parsed.value;
      if (typeof type !== "string" || !type) return 'The event needs a "type".';
      if (typeof rawSender !== "string" || !rawSender) return 'The event needs a "sender".';
      if (typeof content !== "object" || content === null || Array.isArray(content)) return 'The event needs a "content" object.';
      return { type, sender: rawSender, content: content as Record<string, unknown> };
    }
    if (!sender) return "The sender is missing.";
    switch (sendForm) {
      case "message":
        return draft.body ? { type: "m.room.message", sender, content: { msgtype: "m.text", body: draft.body } } : "The body is missing.";
      case "sticker":
        return mxc(draft.stickerUrl) ? { type: "m.sticker", sender, content: { body: draft.stickerBody, url: draft.stickerUrl.trim(), info: {} } } : "The URL must be an mxc:// URI.";
      case "rtcMember":
        if (!draft.rtcDeviceId.trim()) return "The device ID is missing.";
        // TODO-FINDING devbackend-rtc-member-shape - which event the "RTC member" form sends is not specified. The mockup lists `org.matrix.msc4143.rtc.member` timeline events, the fixtures schedule the `org.matrix.msc3401.call.member` state event. For now: a timeline event of the first type with a minimal MSC4143 content (empty content = left).
        return {
          type: "org.matrix.msc4143.rtc.member",
          sender,
          content: draft.rtcJoined ? { application: "m.call", call_id: "", scope: "m.room", device_id: draft.rtcDeviceId.trim(), focus_active: { type: "livekit", focus_selection: "oldest_membership" }, foci_preferred: [] } : {},
        };
      case "media":
        return mxc(draft.mediaUrl) ? { type: "m.room.message", sender, content: { msgtype: draft.msgtype, body: draft.mediaBody, url: draft.mediaUrl.trim() } } : "The URL must be an mxc:// URI.";
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const event = build();
    const delayed = delayOf(delay);
    const problem = typeof event === "string" ? event : delayed.error;
    setError(problem);
    if (problem || typeof event === "string") return;
    // TODO-FINDING devbackend-delayed-sender - the form offers any sender, but the DevBackend only schedules a delayed event for its own user (the backend's `sendDelayedEvent` sends as the user); another sender is refused and shown as a toast. Options: disable the sender field while "Delayed" is on, or allow it in the backend.
    dispatch({ type: "mock/sendEvent", roomId, event, ...(delayed.delayMs === undefined ? {} : { delayMs: delayed.delayMs }) });
  };
  const selectForm = (form: SendForm) => {
    setError(undefined);
    dispatch({ type: "mock/setSendForm", form });
  };

  const now = useNow(scheduled.some((s) => s.scheduledAt !== undefined && s.scheduledAt + s.delayMs > Date.now()));
  const due = (s: MockedRoomData["scheduled"][number]) => {
    const left = s.scheduledAt === undefined ? 0 : s.scheduledAt + s.delayMs - now;
    return left > 0 ? `in ${(left / 1000).toFixed(1)} s` : `${s.delayMs / 1000} s delay`;
  };

  const [expanded, setExpanded] = useState<string>();
  const [limit, setLimit] = useState(PAGE);
  // TODO-FINDING devbackend-timeline-not-virtualized - `MockedRoomData.timeline` says "the view virtualizes it"; the list renders the newest 100 events and a "Show more" button instead.
  const shown = timeline.slice(0, limit);

  return (
    <>
      <Sub title="Send event" />
      <div className="chips" role="tablist" aria-label="Event form">
        {FORMS.map(({ form, label }) => (
          <button key={form} type="button" className={`chip ${form === sendForm ? "on" : ""}`} role="tab" aria-selected={form === sendForm} onClick={() => selectForm(form)}>
            {label}
          </button>
        ))}
      </div>
      <form className="form" aria-label="Send event" onSubmit={submit}>
        {sendForm === "raw" ? (
          <JsonArea label="Event (JSON)" tall value={draft.raw} onChange={(raw) => set({ raw })} />
        ) : (
          <>
            <Field label="Sender">
              <input className="input mono" list={senders} value={draft.sender} onChange={(e) => set({ sender: e.target.value })} />
            </Field>
            <datalist id={senders}>
              {members.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </>
        )}
        {sendForm === "message" && (
          <Field label="Body">
            <input className="input" value={draft.body} onChange={(e) => set({ body: e.target.value })} />
          </Field>
        )}
        {sendForm === "sticker" && (
          <>
            <Field label="Body">
              <input className="input" value={draft.stickerBody} onChange={(e) => set({ stickerBody: e.target.value })} />
            </Field>
            <Field label="MXC URL">
              <input className="input mono" placeholder="mxc://dev.local/…" value={draft.stickerUrl} onChange={(e) => set({ stickerUrl: e.target.value })} />
            </Field>
          </>
        )}
        {sendForm === "rtcMember" && (
          <>
            <Field label="Device ID">
              <input className="input mono" value={draft.rtcDeviceId} onChange={(e) => set({ rtcDeviceId: e.target.value })} />
            </Field>
            <div className="inline-row">
              <Toggle on={draft.rtcJoined} label="Joined" onChange={(rtcJoined) => set({ rtcJoined })} />
              <span>{draft.rtcJoined ? "Joined" : "Left (empty content)"}</span>
            </div>
          </>
        )}
        {sendForm === "media" && (
          <>
            <Field label="Message type">
              <select className="input mono" value={draft.msgtype} onChange={(e) => set({ msgtype: e.target.value })}>
                <option value="m.image">m.image</option>
                <option value="m.audio">m.audio</option>
              </select>
            </Field>
            <Field label="MXC URL">
              <input className="input mono" placeholder="mxc://dev.local/…" value={draft.mediaUrl} onChange={(e) => set({ mediaUrl: e.target.value })} />
            </Field>
            <Field label="Body">
              <input className="input" placeholder="File name or caption" value={draft.mediaBody} onChange={(e) => set({ mediaBody: e.target.value })} />
            </Field>
          </>
        )}
        <FormError error={error} />
        <DelayRow delay={delay} onChange={setDelay} />
      </form>

      {scheduled.length > 0 && (
        <>
          <Sub title="Scheduled">
            <em className="count">{scheduled.length}</em>
          </Sub>
          <div className="ev-list" role="list" aria-label="Scheduled events">
            {scheduled.map((s) => (
              <div key={s.delayId} className="ev sched" role="listitem" data-delay-id={s.delayId}>
                <span className="mono ev-t">{s.type}</span>
                <span className="ev-time">
                  <Icon name="clock" size={11} /> {due(s)}
                </span>
                <span className="ev-p">{[s.stateKey !== undefined ? `state · ${s.stateKey || "(empty key)"}` : "timeline", s.restarts ? `${s.restarts} restart${s.restarts === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")}</span>
                <span className="ev-acts">
                  {(
                    [
                      ["send", "Send now"],
                      ["restart", "Restart"],
                      ["cancel", "Cancel"],
                    ] as const
                  ).map(([update, label]) => (
                    <Button key={update} sm onClick={() => dispatch({ type: "mock/updateScheduled", roomId, delayId: s.delayId, update })}>
                      {label}
                    </Button>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <Sub title="Events">
        <em className="count">{shown.length < timeline.length ? `${shown.length} of ${timeline.length}` : timeline.length}</em>
      </Sub>
      <div className="ev-list" role="list" aria-label="Timeline events">
        {shown.map((event) => {
          const open = expanded === event.eventId;
          return (
            <div key={event.eventId} className="ev-item" role="listitem">
              <button type="button" className="ev" aria-expanded={open} onClick={() => setExpanded(open ? undefined : event.eventId)}>
                <span className="mono ev-t">{event.type}</span>
                <span className="ev-time">{timeOf(event.timestamp)}</span>
                <span className="ev-p">{previewOf(event.content)}</span>
                <span className="ev-s">{event.sender}</span>
              </button>
              {open && (
                <pre className="code">
                  <Json value={{ event_id: event.eventId, type: event.type, sender: event.sender, origin_server_ts: event.timestamp, content: event.content }} />
                </pre>
              )}
            </div>
          );
        })}
        {timeline.length === 0 && <p className="hint">No events yet.</p>}
        {shown.length < timeline.length && (
          <Button sm onClick={() => setLimit(limit + PAGE)}>
            Show more
          </Button>
        )}
      </div>
    </>
  );
}
