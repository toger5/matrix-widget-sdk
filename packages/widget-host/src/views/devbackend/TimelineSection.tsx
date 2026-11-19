/**
 * The body of the Timeline panel of the room dev tools: the filter, "Send event", "Scheduled", the
 * events newest first (a widget's pagination request at their top), "Load older events" at the end.
 * Stories `sidepanel-devbackendview--timeline*` (a widget's pagination request:
 * `sidepanel-devbackendview--timeline-pagination-requested`, `rooms-roomdevtools--one-panel`),
 * `sidepanel-roomtoolsview--timeline`, `rooms-roomdevtools--*`.
 */
import { useId, useMemo, useState, type FormEvent } from "react";

import { OLDER_EVENTS_PER_LOAD, type MockedPagination, type MockedTimelineEvent, type RoomId, type RoomToolsViewModel, type ScheduledEvent } from "../../appViewModel";
import type { RawEvent } from "../../session";
import { useDispatch } from "../env";
import { previewOf } from "../helpers";
import { Button, Check, Field, Icon, Json, Toggle } from "../ui/atoms";
import { FormError, JsonArea, parseJsonObject, pretty } from "../ui/forms";
import { Compose, DelayRow, Front, NO_DELAY, PanelTools, UserId, delayOf, timeOf, useNow, type FormMenuItem } from "./parts";
import type { RoomBoxMode } from "./RoomBox";

type SendForm = RoomToolsViewModel["sendForm"];
type NewEvent = Pick<MockedTimelineEvent, "type" | "sender" | "content">;

const FORMS: FormMenuItem<SendForm>[] = [
  { form: "message", label: "Message" },
  { form: "sticker", label: "Sticker" },
  { form: "rtcMember", label: "RTC member" },
  { form: "media", label: "Image / audio" },
  { form: "raw", label: "Raw JSON", group: true },
];

/** How many events the list renders at first, and per "Show more". */
const PAGE = 100;
/** How many messages "Resolve" offers to generate when the widget gave no number. */
const DEFAULT_PAGINATION_EVENTS = 20;

interface Props {
  /** "account": a real room: the sender is the account (read-only), "Scheduled" lists what was scheduled here, older events can be loaded. */
  mode: RoomBoxMode;
  roomId: RoomId;
  sendForm: SendForm;
  /** The events of the room, oldest first (`RoomTimeline.events`); the list shows them newest first. */
  events: RawEvent[];
  /** `RoomTimeline.atStart`: there is nothing older to load. */
  atStart: boolean;
  loadingOlder: boolean;
  scheduled: ScheduledEvent[];
  /** DevBackend: the pagination of the room's timeline cache; a widget's request is resolved here. */
  pagination?: MockedPagination;
  /** The default sender (DevBackend), or the only one (account). */
  userId?: string;
  /** Suggestions for the sender field. */
  members: string[];
}

const keyOf = (event: RawEvent, index: number) => (typeof event.event_id === "string" ? event.event_id : `#${index}`);

export function TimelineSection({ mode, roomId, sendForm, events, atStart, loadingOlder, scheduled, pagination, userId = "", members }: Props) {
  const dispatch = useDispatch();
  const senders = useId();
  const account = mode === "account";

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
    const sender = account ? userId : draft.sender.trim();
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
        // TODO-FINDING devbackend-rtc-member-shape - which event the "RTC member" form sends is not specified. The design lists `org.matrix.msc4143.rtc.member` timeline events, the fixtures schedule the `org.matrix.msc3401.call.member` state event. For now: a timeline event of the first type with a minimal MSC4143 content (empty content = left).
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
    dispatch({ type: "roomTools/sendEvent", roomId, event, ...(delayed.delayMs === undefined ? {} : { delayMs: delayed.delayMs }) });
  };
  const selectForm = (form: SendForm) => {
    setError(undefined);
    dispatch({ type: "roomTools/setSendForm", form });
  };

  const now = useNow(scheduled.some((s) => s.scheduledAt !== undefined && s.scheduledAt + s.delayMs > Date.now()));
  const due = (s: ScheduledEvent) => {
    const left = s.scheduledAt === undefined ? 0 : s.scheduledAt + s.delayMs - now;
    return left > 0 ? { text: `${(left / 1000).toFixed(1)} s`, title: `Sent in ${(left / 1000).toFixed(1)} s` } : { text: `${s.delayMs / 1000} s`, title: `${s.delayMs / 1000} s delay` };
  };

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<string>();
  const [limit, setLimit] = useState(PAGE);
  // TODO-FINDING devbackend-timeline-not-virtualized - the list renders the newest 100 events and a "Show more" button instead of a virtualized list.
  const newest = useMemo(() => events.map((event, i) => ({ key: keyOf(event, i), event })).reverse(), [events]);
  const f = filter.trim().toLowerCase();
  // String(): the event may come from a homeserver, which may send anything.
  const matching = useMemo(() => (f ? newest.filter(({ event }) => String(event.type).toLowerCase().includes(f) || String(event.sender ?? "").toLowerCase().includes(f)) : newest), [newest, f]);
  const shown = matching.slice(0, limit);
  const loadOlder = () => {
    if (loadingOlder) return;
    setLimit(events.length + OLDER_EVENTS_PER_LOAD);
    dispatch({ type: "room/loadOlderEvents", roomId });
  };

  return (
    <>
      <PanelTools label="Filter events by type or sender" placeholder="Filter by type or sender" filter={filter} onFilter={setFilter} shown={matching.length} total={newest.length} />
      <div className="rdt-body">
        <Compose name="Send event" open={open} onOpen={setOpen} forms={FORMS} active={sendForm} onSelect={selectForm}>
          <form className="form" aria-label="Send event" onSubmit={submit}>
            {sendForm === "raw" ? (
              <JsonArea label="Event (JSON)" tall value={draft.raw} onChange={(raw) => set({ raw })} />
            ) : account ? (
              <Field label="Sender">
                <input className="input mono" readOnly aria-readonly="true" value={userId} />
              </Field>
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
                <input className="input" placeholder="Message text" value={draft.body} onChange={(e) => set({ body: e.target.value })} />
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
        </Compose>

        <div className="rdt-list">
          {scheduled.length > 0 && (
            <>
              <div className="dt-sub" title={account ? "Only the delayed events you scheduled here: the homeserver does not list the others." : undefined}>
                <span>Scheduled</span>
              </div>
              <div role="list" aria-label="Scheduled events">
                {scheduled.map((s) => {
                  const when = due(s);
                  return (
                    <div key={s.delayId} className="msg" role="listitem" data-delay-id={s.delayId}>
                      <div className="msg-h rdt-sched">
                        <span className="rdt-due" title={when.title}>
                          <Icon name="clock" size={11} />
                          {when.text}
                        </span>
                        <Front className="rdt-t" text={s.type} />
                        <span className="rdt-p">{[s.stateKey !== undefined ? `state · ${s.stateKey || "(empty key)"}` : "timeline", s.restarts ? `${s.restarts} restart${s.restarts === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")}</span>
                        <span className="rdt-acts">
                          {(
                            [
                              ["send", "send", "Send now"],
                              ["restart", "refresh", "Restart"],
                              ["cancel", "x", "Cancel"],
                            ] as const
                          ).map(([update, icon, label]) => (
                            <button key={update} type="button" className="dt-ib" title={label} aria-label={label} onClick={() => dispatch({ type: "roomTools/updateScheduled", roomId, delayId: s.delayId, update })}>
                              <Icon name={icon} size={12} />
                            </button>
                          ))}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div className="dt-sub">
            <span>Events</span>
          </div>
          {pagination?.requested && (
            // A new request (another limit) starts with its own default.
            <PaginationRequest key={pagination.requested.limit ?? "none"} roomId={roomId} limit={pagination.requested.limit} />
          )}
          <div role="list" aria-label="Timeline events">
            {shown.map(({ key, event }) => {
              const isOpen = expanded === key;
              const timestamp = Number(event.origin_server_ts);
              const preview = previewOf(event.content ?? {});
              return (
                <div key={key} className={`msg ${isOpen ? "open" : ""}`} role="listitem">
                  <button type="button" className="msg-h" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? undefined : key)}>
                    <Icon name={isOpen ? "chevDown" : "chevRight"} size={11} />
                    <Front className="rdt-t" text={String(event.type)} />
                    <span className={`rdt-p ${preview.startsWith("{") ? "mono" : ""}`}>{preview}</span>
                    {typeof event.sender === "string" && <UserId id={event.sender} />}
                    <span className="msg-time">{timeOf(Number.isFinite(timestamp) ? timestamp : undefined)}</span>
                  </button>
                  {isOpen && (
                    <div className="msg-b">
                      <pre className="code">
                        <Json value={event} />
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {matching.length === 0 && <p className="dt-empty">{newest.length ? "No event matches the filter." : "No events yet. Every event of the room is listed here, newest first."}</p>}
          {shown.length < matching.length && (
            <div className="msg">
              <button type="button" className="msg-h rdt-more" onClick={() => setLimit(limit + PAGE)}>
                Show more
              </button>
            </div>
          )}
          {shown.length === matching.length && !atStart && (
            <div className="msg">
              <button type="button" className="msg-h rdt-more" aria-disabled={loadingOlder || undefined} onClick={loadOlder}>
                {loadingOlder ? "Loading older events…" : "Load older events"}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * DevBackend: a widget asked for older events (`paginate_timeline`) and waits, in a row at the top of
 * the events. "Resolve" generates the messages before the oldest event and tells the widgets.
 */
function PaginationRequest({ roomId, limit }: { roomId: RoomId; limit?: number }) {
  const dispatch = useDispatch();
  const [count, setCount] = useState(String(limit ?? DEFAULT_PAGINATION_EVENTS));
  const [startReached, setStartReached] = useState(false);
  const [error, setError] = useState<string>();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(count);
    if (count.trim() === "" || !Number.isInteger(n) || n < 0 || n > 1000) {
      setError("A whole number from 0 to 1000.");
      return;
    }
    setError(undefined);
    dispatch({ type: "mock/resolvePagination", roomId, count: n, startReached });
  };
  return (
    <div className="msg">
      <form
        className="msg-h rdt-pag"
        aria-label="Pagination request"
        title="A widget waits for older events. “Resolve” adds this many random messages before the oldest event and tells the widgets."
        onSubmit={submit}
      >
        <Icon name="clock" size={12} />
        <span className="rdt-t">paginate_timeline</span>
        <span className="muted">{limit === undefined ? "no number given" : `${limit} requested`}</span>
        <span className="sp" />
        <input className="input sm mono narrow" aria-label="Messages to generate" type="number" min={0} max={1000} step={1} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
        <label>
          <Check on={startReached} label="Start reached" onChange={setStartReached} />
          Start reached
        </label>
        <Button kind="primary" sm type="submit">
          Resolve
        </Button>
      </form>
      <FormError error={error} />
    </div>
  );
}
