import { useEffect, useRef, useState } from "react";
import { WidgetHostDriver, type DriverSnapshot, type MatrixBackend, type WidgetHostPlatform } from "@matrix-widget-tools/widget-host-bindings";

import { LEGACY_AUTO_APPROVED, type ResolvedWidget } from "../widgetStateEvent";
import { envelope, pretty, stringify } from "./format";
import { onDriverLog } from "./hostLogging";

/** MSC4412 recommends showing an error when `notify_ready` has not arrived after 15 seconds. */
const NOTIFY_READY_TIMEOUT_MS = 15_000;
const MAX_LOG_LINES = 500;

const LABELS = { in: "← widget", out: "→ widget", err: "error", info: "info", sdk: "sdk" };

interface LogLine {
  id: number;
  time: string;
  kind: keyof typeof LABELS;
  data: unknown;
}

/** How a widget view behaves beyond the defaults; the in-memory mode sets these. */
export interface WidgetOptions {
  /** Approve every capability request without a prompt. */
  autoApprove?: boolean;
  /** Hand out OpenID tokens without a prompt. */
  autoApproveOpenId?: boolean;
  /** Start with the message log and the driver panel open. */
  devtoolsOpen?: boolean;
}

interface Props {
  widget: ResolvedWidget;
  /** A backend bound to the room the widget lives in. */
  backend: MatrixBackend;
  /** Called when the widget asks to open a URI; throw to refuse. */
  onNavigate: (uri: string) => void;
  options?: WidgetOptions;
}

/**
 * One widget: its iframe, its own `WidgetHostDriver`, the capability and OpenID prompts, a message
 * log and a driver panel. The iframe and the driver live and die together: give the component a
 * new `key` whenever the widget URL or the backend changes.
 */
export function WidgetView({ widget, backend, onNavigate, options }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const driverRef = useRef<WidgetHostDriver | undefined>(undefined);
  const nextLogId = useRef(0);
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [ready, setReady] = useState(!widget.usesWidgetApi);
  const [timedOut, setTimedOut] = useState(false);
  const [requested, setRequested] = useState<string[] | undefined>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [snapshot, setSnapshot] = useState<DriverSnapshot | undefined>();
  const [openIdPending, setOpenIdPending] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [showLog, setShowLog] = useState(options?.devtoolsOpen === true);
  const [showDriver, setShowDriver] = useState(options?.devtoolsOpen === true);
  const [dark, setDark] = useState(false);
  const [visible, setVisible] = useState(true);

  /** Into the log panel only. */
  const append = (kind: LogLine["kind"], data: unknown) => {
    const line = { id: nextLogId.current++, time: new Date().toISOString().slice(11, 23), kind, data };
    setLines((old) => [line, ...old].slice(0, MAX_LOG_LINES));
  };
  /** Something this host did or saw: into the log panel and the browser console. */
  const log = (kind: LogLine["kind"], data: unknown) => {
    (kind === "err" ? console.error : console.info)("[WidgetHost]", LABELS[kind], data);
    append(kind, data);
  };
  const logRef = useRef(log);
  logRef.current = log;
  const appendRef = useRef(append);
  appendRef.current = append;
  const refresh = () => setSnapshot(driverRef.current?.snapshot());

  const { url, legacy, usesWidgetApi } = widget;
  useEffect(() => {
    const origin = new URL(url).origin;
    const log: typeof logRef.current = (kind, data) => logRef.current(kind, data);

    // The driver calls these synchronously from inside its own methods, so anything that calls
    // back into the driver is deferred.
    const platform: WidgetHostPlatform = {
      sendToWidget(json) {
        const message = JSON.parse(json);
        log("out", message);
        iframeRef.current?.contentWindow?.postMessage(message, origin);
      },
      onCapabilitiesRequested(caps) {
        queueMicrotask(() => {
          if (optionsRef.current?.autoApprove) {
            driver.approveCapabilities(caps);
          } else {
            setRequested(caps);
            setSelected(new Set(caps));
          }
          refresh();
        });
      },
      onReady() {
        queueMicrotask(() => setReady(true));
      },
      onOpenidRequested() {
        queueMicrotask(() => setOpenIdPending(true));
      },
      navigate(uri) {
        navigateRef.current(uri);
      },
      setAlwaysOnScreen: () => false,
      clientId: () => "widget-host",
      clientTheme: () => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
      clientLanguage: () => navigator.language,
    };

    const driver = new WidgetHostDriver(backend, platform);
    // What a legacy client gave a widget without asking; the compat wrapper requests these as
    // capabilities, so grant them without a prompt. The driver applies the rule.
    if (legacy) driver.setAutoApproved(LEGACY_AUTO_APPROVED);
    driver.setOpenidAutoApproved(optionsRef.current?.autoApproveOpenId === true);
    driverRef.current = driver;
    refresh();

    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== iframeRef.current?.contentWindow) return;
      log("in", ev.data);
      driver
        .handleMessageFromWidget(typeof ev.data === "string" ? ev.data : JSON.stringify(ev.data))
        // Why a message was rejected is in the driver's log (shown here as "sdk" lines).
        .catch((e: unknown) => log("err", String(e)))
        .finally(refresh);
    };
    window.addEventListener("message", onMessage);
    // The host crates write their records to the console themselves; here they only join the panel.
    const stopDriverLog = onDriverLog((kind, text) => appendRef.current(kind, text));

    const timer = usesWidgetApi
      ? window.setTimeout(() => {
          if (driver.snapshot().ready) return;
          setTimedOut(true);
          log("err", "widget did not send notify_ready in time");
        }, NOTIFY_READY_TIMEOUT_MS)
      : undefined;

    return () => {
      window.removeEventListener("message", onMessage);
      stopDriverLog();
      clearTimeout(timer);
      // Taking every capability away makes the driver cancel its backend subscriptions.
      driver.revokeCapabilities(driver.snapshot().approved);
      driverRef.current = undefined;
    };
  }, [url, legacy, usesWidgetApi, backend]);

  const autoApproveOpenId = options?.autoApproveOpenId === true;
  useEffect(() => {
    driverRef.current?.setOpenidAutoApproved(autoApproveOpenId);
  }, [autoApproveOpenId]);

  const approve = (caps: string[]) => {
    driverRef.current?.approveCapabilities(caps);
    setRequested(undefined);
    refresh();
  };
  const toggle = (cap: string) =>
    setSelected((old) => {
      const next = new Set(old);
      if (!next.delete(cap)) next.add(cap);
      return next;
    });
  const resolveOpenId = (allowed: boolean) => {
    setOpenIdPending(false);
    driverRef.current
      ?.resolveOpenid(allowed)
      .catch((e: unknown) => log("err", String(e)))
      .finally(refresh);
  };
  const revokeAll = () => {
    const driver = driverRef.current;
    if (!driver) return;
    // The host may take capabilities away at any time; the widget gets the reduced list.
    driver.revokeCapabilities(driver.snapshot().approved);
    log("info", "all capabilities revoked; the widget gets update_capabilities with an empty list");
    refresh();
  };
  const pushTheme = () => {
    driverRef.current?.updateTheme({ name: dark ? "light" : "dark", is_dark: !dark });
    setDark(!dark);
  };
  const pushVisibility = () => {
    driverRef.current?.updateVisibility(!visible);
    setVisible(!visible);
  };

  const approved = snapshot?.approved ?? [];
  return (
    <div className="widget">
      <div className="widget-bar">
        <strong>{widget.name}</strong>
        <span className="muted">{widget.legacy ? "legacy, via compat wrapper" : new URL(widget.url).origin}</span>
        <span className="spacer" />
        <span className="muted">{approved.length} capabilities</span>
        <button onClick={revokeAll} disabled={approved.length === 0}>
          Revoke all
        </button>
        <button onClick={() => setShowDriver((v) => !v)}>{showDriver ? "Hide driver" : "Driver"}</button>
        <button onClick={() => setShowLog((v) => !v)}>{showLog ? "Hide messages" : `Messages (${lines.length})`}</button>
      </div>

      {requested && (
        <div className="prompt caps">
          <div>This widget asks for these capabilities:</div>
          {requested.map((cap) => (
            <label key={cap}>
              <input type="checkbox" checked={selected.has(cap)} onChange={() => toggle(cap)} /> <code>{cap}</code>
            </label>
          ))}
          <div>
            <button onClick={() => approve(requested.filter((c) => selected.has(c)))}>Approve selected</button>{" "}
            <button onClick={() => approve([])}>Deny all</button>
          </div>
        </div>
      )}
      {openIdPending && (
        <div className="prompt openid">
          <div>This widget asks for an OpenID token, which proves your identity to the widget's server.</div>
          <div>
            <button onClick={() => resolveOpenId(true)}>Allow</button> <button onClick={() => resolveOpenId(false)}>Block</button>
          </div>
        </div>
      )}

      <div className="widget-body">
        <iframe
          ref={iframeRef}
          src={widget.url}
          title={widget.name}
          hidden={!ready}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
          allow="camera; microphone; display-capture; autoplay; clipboard-write; fullscreen"
        />
        {!ready && <div className="waiting">{timedOut ? "The widget did not send notify_ready within 15 seconds." : "Waiting for the widget…"}</div>}
        {(showDriver || showLog) && (
          <div className="devtools">
            {showDriver && (
              <div className="driver">
                <h2>Host → widget</h2>
                <button onClick={pushTheme}>update_theme ({dark ? "light" : "dark"})</button>
                <button onClick={() => driverRef.current?.updateLanguage("de")}>update_language (de)</button>
                <button onClick={pushVisibility}>update_visibility ({visible ? "hidden" : "visible"})</button>
                <h2>Driver snapshot</h2>
                <pre className="snapshot">{stringify(snapshot, 2)}</pre>
              </div>
            )}
            {showLog && (
              <div className="log">
                <h2>
                  Messages <button onClick={() => setLines([])}>clear</button>
                </h2>
                {lines.map((line) => (
                  <LogEntry key={line.id} line={line} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** One log line: time and direction, then for envelopes the action, `(request|response <id>)` and the body. */
function LogEntry({ line }: { line: LogLine }) {
  const msg = envelope(line.data);
  return (
    <pre className={line.kind}>
      {line.time} {LABELS[line.kind]}{" "}
      {msg ? (
        <>
          <span className="action">{msg.action}</span>
          {"\n"}
          <span className={msg.direction}>
            ({msg.direction} {msg.requestId})
          </span>
          {"\n"}
          {stringify(msg.body, 2)}
        </>
      ) : (
        pretty(line.data)
      )}
    </pre>
  );
}
