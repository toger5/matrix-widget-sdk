/**
 * One running widget: its `WidgetHostDriver`, the message pump between the driver and the iframe,
 * and the data its dev tools show. The iframe element itself is rendered by `WidgetIframes`, which
 * hands it over with `attach()`. A runtime is created when a widget starts and disposed when it
 * stops; a reload (`widget/reload`: "Retry", the reload button of the dev tool bar) disposes it and
 * creates a new one.
 */
import { WidgetHostDriver, type DriverSnapshot, type MatrixBackend, type WidgetHostPlatform } from "@matrix-widget-tools/widget-host-bindings";

import { MAX_STATS_BUCKETS, STATS_BUCKET_MS, type WidgetDevToolsData, type WidgetInstanceId, type WidgetMessage } from "../../appViewModel";
import { loadCapabilities, saveCapabilities } from "../../lib/capabilityStore";
import { onDriverLog } from "../../lib/hostLogging";
import { LEGACY_AUTO_APPROVED, type ResolvedWidget } from "../../widgetStateEvent";
import { Store } from "../store";

/** MSC4412 recommends showing an error when `notify_ready` has not arrived after 15 seconds. */
export const NOTIFY_READY_TIMEOUT_MS = 15_000;
const MAX_MESSAGES = 500;
const MAX_CONSOLE_LINES = 500;

/** What the controller wants to know about. Called asynchronously, never from inside a driver call. */
export interface WidgetRuntimeEvents {
  ready(): void;
  failed(error: string): void;
  /** The widget asks for capabilities (`undefined`: the question was answered). */
  capabilitiesRequested(requested: string[] | undefined): void;
  openIdRequested(pending: boolean): void;
  alwaysOnScreen(value: boolean): void;
  /** A message was handled: the backend may have changed (the DevBackend has no change notification). */
  activity(): void;
}

export interface WidgetRuntimeOptions {
  id: WidgetInstanceId;
  widget: ResolvedWidget;
  backend: MatrixBackend;
  /** Where approved capabilities are remembered (`capabilityStoreKey`); `undefined`: the widget is asked every time. */
  capabilityKey?: string;
  /** Read whenever the widget asks, so a changed setting applies to a running widget. */
  autoApproveCapabilities: () => boolean;
  autoApproveOpenId: () => boolean;
  /** `get_client_context`'s theme. */
  theme: () => "light" | "dark";
  /** How long the widget has for `notify_ready`. Default: `NOTIFY_READY_TIMEOUT_MS`; scripted runs shorten it (`HostSeed.notifyReadyTimeoutMs`). */
  notifyReadyTimeoutMs?: number;
  events: WidgetRuntimeEvents;
}

interface Envelope {
  action: string;
  request_id: string;
  request?: unknown;
  response?: unknown;
}

const asEnvelope = (data: unknown): Envelope | undefined => {
  if (typeof data !== "object" || data === null) return undefined;
  const msg = data as Record<string, unknown>;
  return typeof msg.action === "string" && typeof msg.request_id === "string" ? (msg as unknown as Envelope) : undefined;
};

const isError = (response: unknown) => typeof response === "object" && response !== null && "error" in response;

const emptyData = (): WidgetDevToolsData => ({
  messages: [],
  stats: { actionsFromWidget: 0, actionsToWidget: 0, eventsSharedWithWidget: 0, eventsSentFromWidget: 0, charactersTotal: { toWidget: 0, fromWidget: 0 }, characters: [] },
  capabilities: { approved: [], autoApproved: [], denied: [] },
  console: [],
});

export class WidgetRuntime {
  readonly id: WidgetInstanceId;
  /** What the dev tool panels of this widget show. Recorded from the start, also while the dev tools are closed. */
  readonly devTools = new Store<WidgetDevToolsData>(emptyData());
  /** Every envelope in both directions, as it crossed the wire, oldest first. For the e2e test hook only. */
  readonly wireLog: { direction: "fromWidget" | "toWidget"; message: unknown }[] = [];

  private readonly driver: WidgetHostDriver;
  private readonly origin: string;
  private readonly cleanup: (() => void)[] = [];
  private iframe: HTMLIFrameElement | null = null;
  private data = emptyData();
  private flushQueued = false;
  private denied = new Set<string>();
  private autoApproved: string[] = [];
  private disposed = false;

  constructor(private readonly options: WidgetRuntimeOptions) {
    const { widget, backend, events } = options;
    this.id = options.id;
    this.origin = new URL(widget.url).origin;

    // The driver calls these synchronously from inside its own methods, so anything that calls
    // back into the driver, or changes the view model, is deferred.
    const later = (work: () => void) => queueMicrotask(() => !this.disposed && work());
    const platform: WidgetHostPlatform = {
      sendToWidget: (json) => {
        const message: unknown = JSON.parse(json);
        this.record("toWidget", message, json.length);
        this.iframe?.contentWindow?.postMessage(message, this.origin);
      },
      onCapabilitiesRequested: (requested) =>
        later(() => {
          if (options.autoApproveCapabilities()) this.answerCapabilities(requested, requested);
          else events.capabilitiesRequested(requested);
          this.refreshCapabilities();
        }),
      onReady: () => later(() => events.ready()),
      onOpenidRequested: () => later(() => events.openIdRequested(true)),
      navigate: (uri) => {
        // TODO-FINDING navigate-confirm-is-synchronous - the driver's `navigate` callback must answer synchronously (an error is passed to the widget), so the confirmation is a blocking `window.confirm` and not the app's modal. Options: an async platform callback in the driver (widget-api-change), or always answer "ok" and ask afterwards.
        if (!window.confirm(`The widget wants to open:\n${uri}`)) throw new Error("the user refused to navigate");
        window.open(uri, "_blank", "noopener");
      },
      setAlwaysOnScreen: (value) => {
        // There is no limit on always-on-screen widgets (the PiP panel has an overflow menu), so the answer is always yes.
        later(() => events.alwaysOnScreen(value));
        return true;
      },
      clientId: () => "widget-host",
      clientTheme: () => options.theme(),
      clientLanguage: () => navigator.language,
    };

    this.driver = new WidgetHostDriver(backend, platform);
    this.remember(options.capabilityKey ? loadCapabilities(options.capabilityKey) : []);
    this.driver.setOpenidAutoApproved(options.autoApproveOpenId());
    this.refreshCapabilities();

    const onMessage = (ev: MessageEvent) => {
      if (!this.iframe || ev.source !== this.iframe.contentWindow) return;
      const json = typeof ev.data === "string" ? ev.data : JSON.stringify(ev.data);
      this.record("fromWidget", ev.data, json.length);
      this.driver
        .handleMessageFromWidget(json)
        // Why a message was rejected is in the driver's log.
        .catch((e: unknown) => this.log("error", String(e)))
        .finally(() => {
          if (this.disposed) return;
          this.refreshCapabilities();
          events.activity();
        });
    };
    window.addEventListener("message", onMessage);
    this.cleanup.push(() => window.removeEventListener("message", onMessage));

    // TODO-FINDING console-panel-source - the WidgetDevToolConsolePanel should show the widget's own console, but the host cannot read the console of a cross-origin iframe: the widget SDK / compat wrapper would have to forward it (a new widget API action). Until then the panel shows this host's log about the widget and the driver's log records. The driver's log is global (`onDriverLog`), so with several widgets open every console shows every record.
    this.cleanup.push(onDriverLog((kind, text) => this.log(kind === "err" ? "warn" : "info", text)));

    if (widget.usesWidgetApi) {
      const timeoutMs = options.notifyReadyTimeoutMs ?? NOTIFY_READY_TIMEOUT_MS;
      const timer = window.setTimeout(() => {
        if (this.driver.snapshot().ready) return;
        this.log("error", "the widget did not send notify_ready in time");
        events.failed(`The widget did not answer within ${timeoutMs / 1000} seconds.`);
      }, timeoutMs);
      this.cleanup.push(() => clearTimeout(timer));
    } else {
      // TODO-FINDING widget-api-without-uses-widget-api - a widget whose state event has `uses_widget_api: false` is shown at once, but the driver still answers it: if it talks the widget API anyway it gets the capability prompt and everything else. Should the host ignore its messages instead?
      later(() => events.ready());
    }
  }

  /** The iframe of this widget was mounted (or unmounted: `null`). */
  attach(iframe: HTMLIFrameElement | null): void {
    this.iframe = iframe;
  }

  snapshot(): DriverSnapshot {
    return this.driver.snapshot();
  }

  /** Answer the open capability request with the approved subset and remember what the widget holds after it. */
  answerCapabilities(approved: string[], requested: string[] = approved): void {
    this.driver.approveCapabilities(approved);
    for (const cap of requested) if (approved.includes(cap)) this.denied.delete(cap);
    else this.denied.add(cap);
    // Added to what is remembered: a widget that asks for less this time keeps its earlier grants.
    const remembered = this.options.capabilityKey ? loadCapabilities(this.options.capabilityKey) : [];
    this.remember([...new Set([...remembered, ...this.driver.snapshot().approved])]);
    this.options.events.capabilitiesRequested(undefined);
    this.refreshCapabilities();
    this.options.events.activity();
  }

  answerOpenId(allow: boolean): void {
    this.options.events.openIdRequested(false);
    void this.driver.resolveOpenid(allow).catch((e: unknown) => this.log("error", String(e)));
  }

  setOpenIdAutoApproved(on: boolean): void {
    this.driver.setOpenidAutoApproved(on);
  }

  /** Take capabilities away; the widget gets `update_capabilities` with the reduced list, and they are forgotten. */
  revoke(capabilities: string[] | "all"): void {
    const approved = this.driver.snapshot().approved;
    const revoked = capabilities === "all" ? approved : capabilities;
    this.driver.revokeCapabilities(revoked);
    const remembered = this.options.capabilityKey ? loadCapabilities(this.options.capabilityKey) : [];
    this.remember(remembered.filter((cap) => !revoked.includes(cap)));
    this.log("info", `revoked ${revoked.length} ${revoked.length === 1 ? "capability" : "capabilities"}`);
    this.refreshCapabilities();
  }

  /**
   * "Add" in the driver panel.
   *
   * TODO-FINDING driver-grant-capability - the driver can only grant what a pending request contains (`approve_capabilities`), so a capability cannot be handed to a running widget. "Add" therefore pre-approves: the capability joins the auto-approved set and is granted without a prompt the next time the widget asks for it. A real grant needs a new driver method (widget-api-change checklist), and the protocol question whether a host may grant what was not requested.
   */
  grant(capability: string): void {
    const remembered = this.options.capabilityKey ? loadCapabilities(this.options.capabilityKey) : this.autoApproved;
    this.denied.delete(capability);
    this.remember([...new Set([...remembered, capability])], true);
    this.log("info", `pre-approved ${capability}: granted without a prompt the next time the widget asks`);
    this.refreshCapabilities();
  }

  /** Tell the widget the host's theme (`update_theme`). The driver sends it only if the widget holds `host:…update_theme`. */
  updateTheme(theme: "light" | "dark"): void {
    this.driver.updateTheme({ name: theme, is_dark: theme === "dark" });
  }

  // TODO: more host actions (update_turn_servers is pushed by the backend; add the ones the driver gains).
  mockHostAction(action: "updateTheme" | "updateLanguage" | "updateVisibility", value: string): void {
    if (action === "updateTheme") this.updateTheme(value === "dark" ? "dark" : "light");
    else if (action === "updateLanguage") this.driver.updateLanguage(value);
    else this.driver.updateVisibility(value === "true");
  }

  clear(what: "messages" | "console"): void {
    this.data = what === "messages" ? { ...this.data, messages: [] } : { ...this.data, console: [] };
    this.flush();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const stop of this.cleanup) stop();
    // Taking every capability away makes the driver cancel its backend subscriptions.
    this.driver.revokeCapabilities(this.driver.snapshot().approved);
    this.iframe = null;
    // Free the driver now: the bindings keep the platform callbacks (which hold this runtime, and so
    // the driver) in a global handle map until the driver is freed, so its finalizer never runs and
    // every stop or reload would keep the old driver and its data. A driver call still in flight
    // holds its own reference. Nothing calls the driver after this (`disposed`, `later`).
    this.driver.uniffiDestroy();
  }

  /**
   * Remember `capabilities` for this widget and have the driver grant them, and what a legacy
   * widget gets anyway, without a prompt from now on. `keepInMemory`: also without a store key.
   */
  private remember(capabilities: string[], keepInMemory = false): void {
    const { capabilityKey, widget } = this.options;
    if (capabilityKey) saveCapabilities(capabilityKey, capabilities);
    // What a legacy client gave a widget without asking; the compat wrapper requests these as capabilities.
    this.autoApproved = [...(widget.legacy ? LEGACY_AUTO_APPROVED : []), ...(capabilityKey || keepInMemory ? capabilities : [])];
    this.driver.setAutoApproved(this.autoApproved);
  }

  private refreshCapabilities(): void {
    const approved = this.driver.snapshot().approved;
    const old = this.data.capabilities;
    const next = {
      approved: [...approved].sort(),
      autoApproved: [...this.autoApproved].sort(),
      // TODO-FINDING driver-denied-list - `DriverSnapshot` has no denied list; this is what this host denied itself since the widget started, minus what was granted later.
      denied: [...this.denied].filter((cap) => !approved.includes(cap)).sort(),
    };
    if (JSON.stringify(old) === JSON.stringify(next)) return;
    this.data = { ...this.data, capabilities: next };
    this.flush();
  }

  private log(level: "log" | "info" | "warn" | "error", text: string): void {
    this.data = { ...this.data, console: [...this.data.console, { level, timestamp: Date.now(), text }].slice(-MAX_CONSOLE_LINES) };
    this.flush();
  }

  /** One envelope crossed the wire: pair it with its request, count it. */
  private record(direction: "fromWidget" | "toWidget", message: unknown, characters: number): void {
    this.wireLog.push({ direction, message });
    const now = Date.now();
    const stats = { ...this.data.stats };
    const bucket = Math.floor(now / STATS_BUCKET_MS) * STATS_BUCKET_MS;
    const last = stats.characters.at(-1);
    const point = last?.timestamp === bucket ? { ...last } : { timestamp: bucket, toWidget: 0, fromWidget: 0 };
    point[direction] += characters;
    stats.charactersTotal = { ...stats.charactersTotal, [direction]: stats.charactersTotal[direction] + characters };
    stats.characters = [...(last?.timestamp === bucket ? stats.characters.slice(0, -1) : stats.characters), point].slice(-MAX_STATS_BUCKETS);

    let messages = this.data.messages;
    const envelope = asEnvelope(message);
    if (envelope && "response" in envelope) {
      // A response travels against the direction of its request.
      const requestDirection = direction === "fromWidget" ? "toWidget" : "fromWidget";
      messages = messages.map((m) =>
        m.id === `${requestDirection}:${envelope.request_id}` && m.response.state === "pending"
          ? { ...m, response: { state: isError(envelope.response) ? "error" : "ok", afterMs: now - m.timestamp, data: envelope.response } }
          : m,
      );
      if (direction === "toWidget" && !isError(envelope.response) && envelope.action.endsWith(".send_event")) stats.eventsSentFromWidget += 1;
    } else {
      const entry: WidgetMessage = {
        id: `${direction}:${envelope?.request_id ?? `raw-${this.wireLog.length}`}`,
        direction,
        action: envelope?.action ?? "(not a widget API message)",
        timestamp: now,
        request: envelope ? envelope.request : message,
        response: { state: "pending" },
      };
      messages = [entry, ...messages].slice(0, MAX_MESSAGES);
      if (direction === "fromWidget") {
        stats.actionsFromWidget += 1;
        if (envelope?.action.endsWith(".notify_ready")) stats.runningSince = now;
      } else {
        stats.actionsToWidget += 1;
        if (envelope?.action.endsWith(".forward_event")) stats.eventsSharedWithWidget += 1;
        if (envelope?.action.endsWith(".update_state")) {
          const events = (envelope.request as { events?: unknown[] } | undefined)?.events;
          stats.eventsSharedWithWidget += Array.isArray(events) ? events.length : 1;
        }
      }
    }
    this.data = { ...this.data, messages, stats };
    this.flush();
  }

  /** Publish at most once per microtask: one postMessage often causes several records. */
  private flush(): void {
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      this.devTools.set(this.data);
    });
  }
}
