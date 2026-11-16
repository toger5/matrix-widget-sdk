import { useMemo, useState } from "react";

import type { WidgetInstanceId, WidgetMessage } from "../../appViewModel";
import { useDispatch } from "../env";
import { Button, Icon, IconButton, Json, type IconName } from "../ui/atoms";
import { clock, splitNamespace } from "./format";

/** The cap of the message log (`WidgetDevToolsData.messages`). */
// TODO-FINDING message-log-cap-constant - the cap (500) is only a comment in the view model; the view repeats it to show "N of 500 max". Export a constant from appViewModel.ts
const MESSAGE_LOG_CAP = 500;

const STATUS: Record<WidgetMessage["response"]["state"], { cls: string; icon: IconName; label: string }> = {
  ok: { cls: "ok", icon: "check", label: "responded" },
  pending: { cls: "pending", icon: "clock", label: "waiting for a response" },
  error: { cls: "err", icon: "alert", label: "error response" },
};

const DIRECTIONS = {
  fromWidget: { cls: "from", badge: "W→H", label: "from widget to host", title: "widget → host", chip: "from widget" },
  toWidget: { cls: "to", badge: "H→W", label: "from host to widget", title: "host → widget", chip: "to widget" },
} as const;

export interface MessagesPanelProps {
  widgetId: WidgetInstanceId;
  messages: WidgetMessage[];
  /** Story only: the message that starts expanded. */
  initialExpanded?: string;
}

/** WidgetDevToolMessagesPanel: the log of the widget API, newest first; a row expands to its request and response. story `widget-devtools--messages-expanded` */
export function MessagesPanel({ widgetId, messages, initialExpanded }: MessagesPanelProps) {
  const dispatch = useDispatch();
  const [filter, setFilter] = useState("");
  const [directions, setDirections] = useState({ fromWidget: true, toWidget: true });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(initialExpanded ? [initialExpanded] : []));

  // TODO-FINDING message-log-order - the design listed the oldest message first, the task says newest first, and `WidgetDevToolsData.messages` does not say how it is ordered. The view sorts by timestamp, newest first
  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return messages.filter((m) => directions[m.direction] && (!needle || m.action.toLowerCase().includes(needle))).sort((a, b) => b.timestamp - a.timestamp);
  }, [messages, filter, directions]);

  const toggle = (id: string) =>
    setExpanded((old) => {
      const next = new Set(old);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <>
      <div className="dt-tools">
        <label className="input search sm">
          <Icon name="search" size={11} />
          <input className="dt-in" type="search" placeholder="Filter by action" aria-label="Filter messages by action" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
        {(Object.keys(DIRECTIONS) as (keyof typeof DIRECTIONS)[]).map((d) => (
          <button key={d} type="button" className={`chip sm ${directions[d] ? "on" : ""}`} aria-pressed={directions[d]} onClick={() => setDirections({ ...directions, [d]: !directions[d] })}>
            {DIRECTIONS[d].badge} {DIRECTIONS[d].chip}
          </button>
        ))}
        <span className="sp" />
        <span className="muted">
          {rows.length === messages.length ? messages.length : `${rows.length} / ${messages.length}`} of {MESSAGE_LOG_CAP} max
        </span>
        <Button sm onClick={() => dispatch({ type: "devTools/clear", widgetId, what: "messages" })}>
          Clear
        </Button>
      </div>
      {/* TODO-FINDING message-log-not-virtualized - appDesign.md asks to virtualize the message list; the log is capped at 500 collapsed rows, so it is a plain list for now */}
      <div className="msgs" role="list" aria-label="Widget API messages" data-testid="devtools-messages">
        {rows.length === 0 && <p className="dt-empty">{messages.length === 0 ? "No messages yet. Every action the widget and the host send each other is listed here." : "No message matches the filter."}</p>}
        {rows.map((m) => (
          <MessageRow key={m.id} widgetId={widgetId} message={m} open={expanded.has(m.id)} onToggle={() => toggle(m.id)} />
        ))}
      </div>
    </>
  );
}

function MessageRow({ widgetId, message, open, onToggle }: { widgetId: WidgetInstanceId; message: WidgetMessage; open: boolean; onToggle: () => void }) {
  const dispatch = useDispatch();
  const dir = DIRECTIONS[message.direction];
  const { response } = message;
  const status = STATUS[response.state];
  const [prefix, action] = splitNamespace(message.action);
  const statusLabel = response.state === "pending" ? status.label : `${status.label} after ${response.afterMs} ms`;
  return (
    <div className={`msg ${open ? "open" : ""}`} role="listitem" data-message-id={message.id}>
      <button type="button" className="msg-h" aria-expanded={open} onClick={onToggle}>
        <Icon name={open ? "chevDown" : "chevRight"} size={11} />
        <span className={`msg-dir ${dir.cls}`} role="img" aria-label={dir.label} title={dir.title}>
          {dir.badge}
        </span>
        <span className="msg-a" title={message.action}>
          {prefix && <i>{prefix}</i>}
          {action}
        </span>
        <span className={`msg-st ${status.cls}`} role="img" aria-label={statusLabel} title={statusLabel}>
          <Icon name={status.icon} size={12} />
          {response.state !== "pending" && <span className="msg-ms">{response.afterMs} ms</span>}
        </span>
        <span className="msg-time">{clock(message.timestamp)}</span>
      </button>
      {open && (
        <div className="msg-b">
          <div className="msg-meta">
            <span>
              request id <b>{message.id}</b>
            </span>
            <span>{response.state === "pending" ? "waiting for a response" : <>responded after <b>{response.afterMs} ms</b></>}</span>
            <span>
              <IconButton icon="copy" title="Copy as JSON" className="xs" onClick={() => dispatch({ type: "devTools/copyMessage", widgetId, messageId: message.id })} />
            </span>
          </div>
          <div className="msg-cols">
            <div>
              <h6>Request · {dir.title}</h6>
              <pre className="code">
                <Json value={message.request} />
              </pre>
            </div>
            <div>
              <h6>{response.state === "error" ? "Error response" : "Response"}</h6>
              {response.state === "pending" ? (
                <p className="muted">Not answered yet.</p>
              ) : (
                <pre className="code">
                  <Json value={response.data} />
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
