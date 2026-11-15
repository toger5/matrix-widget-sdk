import { useEffect, useRef, useState } from "react";
import { matrixEventFromJson, type StoredMedia } from "@matrix-widget-tools/widget-host-bindings";

import type { StateEvent } from "../widgetStateEvent";
import { stringify } from "../lib/format";
import { EXAMPLE_LEGACY, EXAMPLE_NEW, type MemorySession } from "../matrix_session/memory/session";
import type { WidgetOptions } from "../views/WidgetView";

const EXAMPLE_EVENT = {
  type: "m.room.message",
  sender: "@bob:example.org",
  event_id: "$injected-1",
  room_id: "!room:example.org",
  origin_server_ts: 1,
  content: { msgtype: "m.text", body: "hello from the host" },
};
const EXAMPLE_TO_DEVICE = {
  type: "org.example.ping",
  sender: "@bob:example.org",
  content: { n: 1 },
  encrypted: false,
};

/** The store has no change notification, so its dumps are re-read on a timer. */
const REFRESH_MS = 500;

interface Dumps {
  timeline: string;
  state: string;
  delayed: string;
  toDeviceSent: string;
  media: StoredMedia[];
}

interface Props {
  session: MemorySession;
  options: WidgetOptions;
  onOptionsChange: (options: WidgetOptions) => void;
  /** Something that went wrong while setting the session up from the URL. */
  problem?: string;
}

/**
 * The controls of the in-memory store: add widgets to the room, seed what a homeserver would
 * deliver (events, to-device messages, TURN credentials, account data, RTC transports), make
 * sends fail, and inspect what widgets wrote.
 */
export function MemoryStorePanel({ session, options, onOptionsChange, problem }: Props) {
  const { store } = session;
  const [widgetEvent, setWidgetEvent] = useState(() => JSON.stringify(EXAMPLE_NEW, null, 2));
  const [inject, setInject] = useState(() => JSON.stringify({ ...EXAMPLE_EVENT, room_id: session.roomId }, null, 2));
  const [injectToDevice, setInjectToDevice] = useState(() => JSON.stringify(EXAMPLE_TO_DEVICE, null, 2));
  const [failSends, setFailSends] = useState(false);
  const [note, setNote] = useState<{ error: boolean; text: string } | undefined>(problem ? { error: true, text: problem } : undefined);
  const [dumps, setDumps] = useState<Dumps>(() => read(session));
  const turnCounter = useRef(0);

  useEffect(() => {
    const refresh = () => setDumps((old) => sameDumps(old, read(session)));
    refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [session]);

  /** Run a store operation; what it returns, or its error, is shown under the controls. */
  const run = (work: () => string) => {
    try {
      setNote({ error: false, text: work() });
    } catch (e) {
      setNote({ error: true, text: e instanceof Error ? e.message : String(e) });
    }
    setDumps((old) => sameDumps(old, read(session)));
  };

  return (
    <div className="memory">
      <h2>Widget state event</h2>
      <button onClick={() => setWidgetEvent(JSON.stringify(EXAMPLE_NEW, null, 2))}>example: new widget</button>
      <button onClick={() => setWidgetEvent(JSON.stringify(EXAMPLE_LEGACY, null, 2))}>example: legacy widget</button>
      <textarea value={widgetEvent} onChange={(e) => setWidgetEvent(e.target.value)} />
      <button onClick={() => run(() => `widget ${session.addWidget(JSON.parse(widgetEvent) as StateEvent)} is in the room; open it from the list`)}>
        Add widget to the room
      </button>
      <label>
        <input type="checkbox" checked={options.autoApprove === true} onChange={(e) => onOptionsChange({ ...options, autoApprove: e.target.checked })} />{" "}
        auto-approve capabilities
      </label>
      <label>
        <input
          type="checkbox"
          checked={options.autoApproveOpenId === true}
          onChange={(e) => onOptionsChange({ ...options, autoApproveOpenId: e.target.checked })}
        />{" "}
        auto-approve OpenID tokens
      </label>
      {note && <div className={note.error ? "error note" : "muted note"}>{note.text}</div>}

      <h2>Memory store</h2>
      <textarea value={inject} onChange={(e) => setInject(e.target.value)} />
      <button onClick={() => run(() => `stored ${store.inject(matrixEventFromJson(inject)).eventId}; the widget gets it if its capabilities allow`)}>
        Inject event (store; the subscription forwards)
      </button>
      <button onClick={() => run(() => (store.clear(), "store cleared"))}>Clear store</button>
      <label>
        <input
          type="checkbox"
          checked={failSends}
          onChange={(e) => {
            setFailSends(e.target.checked);
            store.failSends(e.target.checked ? "simulated failure (fail sends is on)" : undefined);
          }}
        />{" "}
        fail sends
      </label>

      <h2>Timeline</h2>
      <pre className="timeline">{dumps.timeline}</pre>

      <h2>To-device (MSC3819)</h2>
      <textarea value={injectToDevice} onChange={(e) => setInjectToDevice(e.target.value)} />
      <button
        onClick={() =>
          run(() => {
            const m = JSON.parse(injectToDevice) as { type: string; sender: string; content: unknown; encrypted?: boolean };
            store.injectToDevice({ eventType: m.type, sender: m.sender, content: m.content, encrypted: m.encrypted === true });
            return "delivered to the to-device subscription; the widget gets it if its capabilities allow";
          })
        }
      >
        Inject to-device message
      </button>
      <pre className="to-device-sent">{dumps.toDeviceSent}</pre>

      <h2>Client facts the widget can ask for</h2>
      <button
        onClick={() =>
          run(() => {
            turnCounter.current += 1;
            store.setTurnServer({ uris: ["turn:turn.example.org:3478?transport=udp"], username: `user${turnCounter.current}`, password: "secret" });
            return `TURN credentials #${turnCounter.current} pushed; watching widgets receive update_turn_servers`;
          })
        }
      >
        Push TURN credentials (MSC3846)
      </button>
      <button onClick={() => run(() => (store.setRoomAccountData("m.tag", { tags: { "u.widgets": { order: 0.5 } } }), "room account data m.tag set"))}>
        Set m.tag room account data
      </button>
      <button
        onClick={() => run(() => (store.setRtcTransports([{ type: "livekit", livekit_service_url: "https://livekit.example.org" }]), "rtc transports set"))}
      >
        Set RTC transports (MSC4515)
      </button>

      <h2>Delayed events (MSC4157)</h2>
      <button
        onClick={() =>
          run(() => {
            const next = store.delayedEvents()[0];
            if (!next) return "no delayed event scheduled";
            return `fired ${next.delayId} as ${store.fireDelayedEvent(next.delayId).eventId}`;
          })
        }
      >
        Fire oldest (as if its delay elapsed)
      </button>
      <pre className="delayed">{dumps.delayed}</pre>

      <h2>Media repository (MSC4039)</h2>
      <div className="muted">demo files + everything widgets uploaded; images are previewed</div>
      <MediaList files={dumps.media} />

      <h2>State</h2>
      <pre className="state">{dumps.state}</pre>
    </div>
  );
}

function read({ store }: MemorySession): Dumps {
  return {
    timeline: stringify(store.timeline(), 2),
    state: stringify(store.state(), 2),
    delayed: stringify(store.delayedEvents(), 2),
    toDeviceSent: stringify(store.toDeviceSent(), 2),
    media: store.media(),
  };
}

const mediaKey = (files: StoredMedia[]) => files.map((m) => `${m.contentUri} ${m.file.data.byteLength}`).join("\n");

/** Keep the old object while nothing changed, so React does not re-render every tick. */
function sameDumps(old: Dumps, next: Dumps): Dumps {
  const same =
    old.timeline === next.timeline &&
    old.state === next.state &&
    old.delayed === next.delayed &&
    old.toDeviceSent === next.toDeviceSent &&
    mediaKey(old.media) === mediaKey(next.media);
  return same ? old : next;
}

/** The media repository: images are previewed, everything else can be saved. */
function MediaList({ files }: { files: StoredMedia[] }) {
  // Object URLs by `mxc://` URI, created once per file and released when the panel goes away.
  const urls = useRef(new Map<string, string>());
  useEffect(() => {
    const created = urls.current;
    return () => {
      for (const url of created.values()) URL.revokeObjectURL(url);
      created.clear();
    };
  }, []);

  const urlFor = ({ contentUri, file }: StoredMedia) => {
    const key = `${contentUri} ${file.data.byteLength}`;
    let url = urls.current.get(key);
    if (!url) {
      url = URL.createObjectURL(new Blob([file.data], { type: file.mimetype ?? "" }));
      urls.current.set(key, url);
    }
    return url;
  };

  return (
    <div className="media">
      {files.map((stored) => {
        const { contentUri, file } = stored;
        const name = contentUri.split("/").pop() ?? "file";
        const url = urlFor(stored);
        return (
          <div className="file" key={contentUri}>
            <code>{contentUri}</code>
            <span className="muted">
              {file.mimetype ?? "unknown type"} · {file.data.byteLength} bytes{" "}
            </span>
            <button onClick={() => void navigator.clipboard.writeText(contentUri)}>copy uri</button>{" "}
            <a href={url} download={name}>
              download
            </a>
            {file.mimetype?.startsWith("image/") && <img src={url} alt={name} />}
          </div>
        );
      })}
    </div>
  );
}
