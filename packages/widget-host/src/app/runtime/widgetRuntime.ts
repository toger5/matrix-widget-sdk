/**
 * One running widget: its `WidgetHostDriver`, the message pump between the driver and the iframe,
 * and the data its dev tools show. The iframe element itself is rendered by `WidgetIframes`, which
 * hands it over with `attach()`. A runtime is created when a widget starts and disposed when it
 * stops; a reload (`widget/reload`: "Retry", the reload button of the dev tool bar) disposes it and
 * creates a new one.
 *
 * A runtime also decides the iframe's `sandbox` and `allow` (`webview`), once, from the webview
 * capabilities the widget gets without asking: remembered ones, a legacy client's set for a legacy
 * widget, and what the controller kept from the start before (`keptWebview`). When the widget
 * comes to hold one the iframe does not have, or one is revoked, it reports `webviewChanged`, and
 * the controller starts the widget again with the new attributes (`src/lib/webview.ts`).
 */
import { capabilityIsKnown, WidgetHostDriver, type DriverSnapshot, type MatrixBackend, type WidgetHostPlatform } from "@matrix-widget-tools/widget-host-bindings";

import { MAX_STATS_BUCKETS, STATS_BUCKET_MS, type WebviewAttributes, type WidgetDevToolsData, type WidgetInstanceId, type WidgetMessage } from "../../appViewModel";
import { loadCapabilities, saveCapabilities } from "../../lib/capabilityStore";
import { onDriverLog } from "../../lib/hostLogging";
import { sameWebview, webviewCapabilities, webviewFor } from "../../lib/webview";
import { LEGACY_AUTO_APPROVED, LEGACY_WEBVIEW, type ResolvedWidget } from "../../widgetStateEvent";
import { Store } from "../store";

/** MSC4412 recommends showing an error when `notify_ready` has not arrived after 15 seconds. */
export const NOTIFY_READY_TIMEOUT_MS = 15_000;
const MAX_MESSAGES = 500;
const MAX_CONSOLE_LINES = 500;

/** What the controller wants to know about. Called asynchronously, never from inside a driver call. */
export interface WidgetRuntimeEvents {
  ready(): void;
  failed(error: string): void;
  /**
   * The open capability question of the widget, whole: every request since the last answer joins
   * it (`undefined`: it was answered). `unknown`: those of `requested` the driver does not know;
   * `singleUse`: those it grants for one use.
   */
  capabilitiesRequested(question: { requested: string[]; unknown: string[]; singleUse: string[] } | undefined): void;
  alwaysOnScreen(value: boolean): void;
  /** A message was handled: the backend may have changed (the DevBackend has no change notification). */
  activity(): void;
  /**
   * The iframe's attributes (`WidgetRuntime.webview`) are not what the widget should have any more: it
   * holds a webview capability they lack (granted after the widget asked, "Add" of the driver panel),
   * or one was revoked. `kept`: the webview capabilities for the next start, besides the remembered and
   * the legacy ones (the next `keptWebview`). The widget has been told (`update_capabilities`); start it
   * again to apply them. At most once per runtime.
   */
  webviewChanged(kept: string[]): void;
}

export interface WidgetRuntimeOptions {
  id: WidgetInstanceId;
  widget: ResolvedWidget;
  backend: MatrixBackend;
  /** Where approved capabilities are remembered (`capabilityStoreKey`); `undefined`: the widget is asked at every start. */
  capabilityKey?: string;
  /** Read whenever the widget asks, so a changed setting applies to a running widget. Covers the one-use `get_openid` too: every token is granted without a prompt. */
  autoApproveCapabilities: () => boolean;
  /** `get_client_context`'s theme. */
  theme: () => "light" | "dark";
  /** How long the widget has for `notify_ready`. Default: `NOTIFY_READY_TIMEOUT_MS`; scripted runs shorten it (`HostSeed.notifyReadyTimeoutMs`). */
  notifyReadyTimeoutMs?: number;
  /**
   * Webview capabilities the iframe gets from the start besides the remembered and the legacy ones,
   * and that are granted without a prompt: what the start before reported as `kept` (`webviewChanged`).
   */
  keptWebview?: string[];
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
  capabilities: { approved: [], autoApproved: [], denied: [], singleUse: [], webview: { applied: [], sandbox: "", allow: "" } },
  console: [],
});

export class WidgetRuntime {
  readonly id: WidgetInstanceId;
  /** What the dev tool panels of this widget show. Recorded from the start, also while the dev tools are closed. */
  readonly devTools = new Store<WidgetDevToolsData>(emptyData());
  /** Every envelope in both directions, as it crossed the wire, oldest first. For the e2e test hook only. */
  readonly wireLog: { direction: "fromWidget" | "toWidget"; message: unknown }[] = [];
  /**
   * The webview capabilities this start's iframe is built from (the base `sandbox` tokens are always
   * in, listed or not) and its `sandbox` and `allow`, which `WidgetIframes` renders. Fixed for the
   * runtime: a change is a new start (`webviewChanged`).
   */
  readonly webview: { applied: string[] } & WebviewAttributes;

  private readonly driver: WidgetHostDriver;
  private readonly origin: string;
  private readonly cleanup: (() => void)[] = [];
  private iframe: HTMLIFrameElement | null = null;
  private data = emptyData();
  private flushQueued = false;
  private denied = new Set<string>();
  private autoApproved: string[] = [];
  /**
   * Without a store (no `capabilityKey`): what is granted without a prompt while the widget runs,
   * besides what a legacy widget gets anyway ("Always" of a one-use capability, "Add" of the
   * driver panel). With a store, the store holds it.
   */
  private keptWhileRunning: string[] = [];
  /**
   * The open question as the driver last asked it (`onCapabilitiesRequested`), set at once, before
   * the prompt can show it. Empty once it is answered.
   */
  private asked: string[] = [];
  /** The `keptWebview` of the options, without what was revoked since. */
  private keptWebview: string[];
  /** `webviewChanged` was reported: the controller starts the widget again. */
  private webviewReported = false;
  private disposed = false;

  constructor(private readonly options: WidgetRuntimeOptions) {
    const { widget, backend, events } = options;
    this.id = options.id;
    // The origin of the page the iframe loads: `widget.url` is its `src` (`WidgetIframes`), the URL
    // `embed_widget` checked and serialised, resolved here as the iframe resolves its `src`.
    this.origin = new URL(widget.url, document.baseURI).origin;
    this.keptWebview = webviewCapabilities(options.keptWebview ?? []);
    const applied = this.webviewToApply(this.keptWebview);
    this.webview = { applied, ...webviewFor(applied) };

    // The driver calls these synchronously from inside its own methods, so anything that calls
    // back into the driver, or changes the view model, is deferred.
    const later = (work: () => void) => queueMicrotask(() => !this.disposed && work());
    const platform: WidgetHostPlatform = {
      sendToWidget: (json) => {
        const message: unknown = JSON.parse(json);
        this.record("toWidget", message, json.length);
        this.iframe?.contentWindow?.postMessage(message, this.origin);
      },
      // The whole open question; again, whole, when a request adds to it before the answer.
      onCapabilitiesRequested: (requested) => {
        this.asked = requested;
        later(() => {
          if (options.autoApproveCapabilities()) this.answerCapabilities(requested, requested);
          else {
            const { singleUse } = this.driver.snapshot();
            events.capabilitiesRequested({ requested, unknown: requested.filter((c) => !capabilityIsKnown(c)), singleUse: requested.filter((c) => singleUse.includes(c)) });
          }
          this.refreshCapabilities();
        });
      },
      onReady: () => later(() => events.ready()),
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
    this.remember(this.preApproved());
    this.refreshCapabilities();
    if (applied.length > 0) this.log("info", `the iframe has webview capabilities: sandbox "${this.webview.sandbox}", allow "${this.webview.allow}"`);

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

  /**
   * Answer the open capability question with the approved subset and remember what the widget
   * holds after it. `shown`: what the user was asked about. `always`: the one-use capabilities of
   * `approved` that are granted again whenever the widget asks. An approval is refused while the
   * driver has asked about something that was not shown: a request that arrived just before the
   * click, whose prompt update is still on its way. (Only what the driver asked counts: a
   * capability that a revoke or a shorter auto-approved list put back into its question was never
   * asked about, is not granted by this answer, and must not block it.)
   */
  answerCapabilities(approved: string[], shown: string[] = approved, always: string[] = []): void {
    const unseen = this.asked.filter((c) => !shown.includes(c));
    if (approved.length > 0 && unseen.length > 0) {
      this.log("warn", `approval refused: the widget asked for ${unseen.length} more ${unseen.length === 1 ? "capability" : "capabilities"} that the prompt did not show yet`);
      return;
    }
    this.asked = [];
    this.driver.approveCapabilities(approved);
    for (const cap of [...shown, ...unseen]) if (approved.includes(cap)) this.denied.delete(cap);
    else this.denied.add(cap);
    // Added to what is remembered: a widget that asks for less this time keeps its earlier grants.
    // A one-use capability (`get_openid`) only if the user chose "Always": remembered, it is granted
    // again for every use without asking. Without a store only those are kept, while the widget runs.
    const { approved: held, singleUse } = this.driver.snapshot();
    const kept = this.options.capabilityKey ? held.filter((cap) => !singleUse.includes(cap)) : [];
    this.remember([...this.preApproved(), ...kept, ...always.filter((cap) => approved.includes(cap) && singleUse.includes(cap))]);
    this.options.events.capabilitiesRequested(undefined);
    this.refreshCapabilities();
    this.options.events.activity();
  }

  /**
   * Take capabilities away; the widget gets `update_capabilities` with the reduced list, and they are
   * forgotten. "all": also what is granted without a prompt but not held now (a used up "Always").
   */
  revoke(capabilities: string[] | "all"): void {
    const approved = this.driver.snapshot().approved;
    const revoked = capabilities === "all" ? [...new Set([...approved, ...this.preApproved(), ...this.keptWebview])] : capabilities;
    this.driver.revokeCapabilities(revoked);
    // A revoked webview capability is no longer applied from the next start on (`checkWebview` starts it again at once).
    this.keptWebview = this.keptWebview.filter((cap) => !revoked.includes(cap));
    this.remember(this.preApproved().filter((cap) => !revoked.includes(cap)));
    this.log("info", `revoked ${revoked.length} ${revoked.length === 1 ? "capability" : "capabilities"}`);
    this.refreshCapabilities();
  }

  /**
   * "Add" in the driver panel. For a single-use capability that means "always": granted again,
   * without a prompt, each time the widget requests it.
   *
   * TODO-FINDING driver-grant-capability - the driver can only grant what a pending request contains (`approve_capabilities`), so a capability cannot be handed to a running widget. "Add" therefore pre-approves: the capability joins the auto-approved set and is granted without a prompt the next time the widget asks for it. A real grant needs a new driver method (widget-api-change checklist), and the protocol question whether a host may grant what was not requested.
   */
  grant(capability: string): void {
    this.denied.delete(capability);
    this.remember([...this.preApproved(), capability]);
    this.log("info", `pre-approved ${capability}: granted without a prompt the next time the widget asks`);
    // A webview capability applies with a new start of the iframe (`checkWebview`).
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

  /** What is granted without a prompt besides the legacy capabilities: the store, or without one what is kept while the widget runs. */
  private preApproved(): string[] {
    return this.options.capabilityKey ? loadCapabilities(this.options.capabilityKey) : this.keptWhileRunning;
  }

  /** The webview capabilities a start with `kept` applies: a legacy client's set for a legacy widget, the remembered ones, `kept`. */
  private webviewToApply(kept: readonly string[]): string[] {
    return webviewCapabilities([...(this.options.widget.legacy ? LEGACY_WEBVIEW : []), ...this.preApproved(), ...kept]);
  }

  /**
   * Report `webviewChanged` when the iframe's attributes are not those of a start with what is kept
   * now: the kept ones that were not revoked, every webview capability the widget holds, and those
   * pre-approved while it runs without a store ("Add"; with a store they are remembered).
   * Revoking one that the iframe has, or the widget coming to hold one it lacks, starts it again;
   * a denial changes nothing. Called after every change of the capabilities.
   */
  private checkWebview(approved: readonly string[]): void {
    if (this.webviewReported || this.disposed) return;
    const kept = webviewCapabilities([...this.keptWebview, ...approved, ...(this.options.capabilityKey ? [] : this.keptWhileRunning)]);
    const next = webviewFor(this.webviewToApply(kept));
    if (sameWebview(next, this.webview)) return;
    this.webviewReported = true;
    this.log("info", `restarting to apply the webview capabilities: sandbox "${next.sandbox}", allow "${next.allow}"`);
    // After the driver's `update_capabilities` has gone out (it is sent from inside the call that granted).
    queueMicrotask(() => !this.disposed && this.options.events.webviewChanged(kept));
  }

  /**
   * Remember `capabilities` for this widget (in the store, or without one while it runs) and have
   * the driver grant them, and what a legacy widget gets anyway, without a prompt from now on.
   */
  private remember(capabilities: string[]): void {
    const { capabilityKey, widget } = this.options;
    const unique = [...new Set(capabilities)];
    if (capabilityKey) saveCapabilities(capabilityKey, unique);
    else this.keptWhileRunning = unique;
    // What a legacy client gave a widget without asking; the compat wrapper requests these as capabilities.
    // And what the iframe was built with: the widget's request for it is granted at once, without a new start.
    this.autoApproved = [...new Set([...(widget.legacy ? LEGACY_AUTO_APPROVED : []), ...unique, ...this.webview.applied])];
    this.driver.setAutoApproved(this.autoApproved);
  }

  private refreshCapabilities(): void {
    const { approved, singleUse } = this.driver.snapshot();
    this.checkWebview(approved);
    const old = this.data.capabilities;
    const next = {
      approved: [...approved].sort(),
      autoApproved: [...this.autoApproved].sort(),
      // TODO-FINDING driver-denied-list - `DriverSnapshot` has no denied list; this is what this host denied itself since the widget started, minus what was granted later.
      denied: [...this.denied].filter((cap) => !approved.includes(cap)).sort(),
      singleUse: [...singleUse].sort(),
      webview: { ...this.webview, applied: [...this.webview.applied].sort() },
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
