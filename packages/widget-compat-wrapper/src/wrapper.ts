/** Browser glue: read the configuration from the URL, create the inner iframe, route messages. */
import { CompatBridge } from "./bridge";
import { LEGACY_ALLOW, LEGACY_SANDBOX } from "./capabilities";
import { type LogLevel, log, parseLogLevel, setLogLevel } from "./log";
import { legacyUrlProblem } from "./url";

/** The `sandbox` attribute of the inner iframe: the one of a legacy client (Element Web), constant. */
export const INNER_SANDBOX = LEGACY_SANDBOX.join(" ");
/** The `allow` attribute of the inner iframe: the one of a legacy client (Element Web, with `fullscreen`), constant. */
export const INNER_ALLOW = LEGACY_ALLOW.join("; ");

/**
 * The inner iframe for the legacy widget at `url` (absolute http(s), checked), in a wrapper on
 * `wrapperOrigin`: its `sandbox` and `allow` attributes and the target origin of the messages to it.
 *
 * Always the attributes of a legacy client ({@link INNER_SANDBOX}, {@link INNER_ALLOW}), except
 * for a legacy widget on the wrapper's own origin: with `allow-same-origin` it would share the
 * wrapper's origin, which is often the client's, and could reach the client's window and storage.
 * It loads without `allow-same-origin`, so it gets an opaque origin, which `postMessage` can only
 * address with `"*"` (only that one window gets the message, `contentWindow`).
 */
export function innerIframe(url: string, wrapperOrigin: string): { sandbox: string; allow: string; targetOrigin: string } {
  const origin = new URL(url).origin;
  if (origin !== wrapperOrigin) return { sandbox: INNER_SANDBOX, allow: INNER_ALLOW, targetOrigin: origin };
  return { sandbox: LEGACY_SANDBOX.filter((token) => token !== "allow-same-origin").join(" "), allow: INNER_ALLOW, targetOrigin: "*" };
}

/** The wrapper's query parameters, parsed. The README describes each parameter. */
export interface WrapperConfig {
  /** The legacy widget URL with its template variables still in it. */
  legacyWidgetUrl: string;
  widgetId: string;
  /** Accessible name of the inner iframe: the legacy widget's name. */
  widgetName: string;
  waitForIframeLoad: boolean;
  widgetData?: Record<string, unknown>;
  /** Target origin for messages to the host. */
  clientOrigin: string;
  /** What the wrapper writes to the console. Default: `warn`. */
  logLevel: LogLevel;
}

/**
 * Read the configuration from the wrapper's query parameters. Throws when a required one is
 * missing, and when `legacy_widget_url` is not an absolute http(s) URL (url.ts).
 */
export function parseConfig(params: URLSearchParams): WrapperConfig {
  const legacyWidgetUrl = params.get("legacy_widget_url");
  if (!legacyWidgetUrl) throw new Error("missing `legacy_widget_url` query parameter");
  const problem = legacyUrlProblem(legacyWidgetUrl);
  if (problem) throw new Error(`refused \`legacy_widget_url\`: ${problem}`);
  const widgetId = params.get("legacy_widget_id") ?? new URL(legacyWidgetUrl).searchParams.get("widgetId");
  if (!widgetId) throw new Error("missing `legacy_widget_id` (and no `widgetId` in the legacy url)");
  const data = params.get("legacy_widget_data");
  return {
    legacyWidgetUrl,
    widgetId,
    widgetName: params.get("legacy_widget_name") ?? widgetId,
    waitForIframeLoad: params.get("legacy_wait_for_iframe_load") !== "false",
    widgetData: data ? (JSON.parse(data) as Record<string, unknown>) : undefined,
    clientOrigin: params.get("client_origin") ?? "*",
    logLevel: parseLogLevel(params.get("log_level")),
  };
}

/** Show why the wrapper does not run, in place of the legacy widget (the host shows it once the widget is visible). */
export function showError(message: string, container: HTMLElement = document.body): void {
  const error = document.createElement("div");
  error.id = "error";
  error.textContent = `Widget compat wrapper: ${message}`;
  container.append(error);
}

/**
 * Connect the legacy widget and `parent` through a {@link CompatBridge} and start the bootstrap.
 * The inner iframe is created in `container` once the bridge knows the templated URL, and never
 * when that URL is refused.
 */
export function startWrapper(config: WrapperConfig, container: HTMLElement, parent: Window = window.parent): CompatBridge {
  setLogLevel(config.logLevel);
  log.info(`wrapping legacy widget ${config.widgetId}`);
  let iframe: HTMLIFrameElement | undefined;
  // The legacy widget's origin, known once its URL is (`*` for one of the wrapper's own origin, which
  // loads with an opaque origin, see `innerIframe`). Messages to the widget are posted to it.
  let widgetOrigin = "*";

  const bridge = new CompatBridge({
    widgetId: config.widgetId,
    waitForIframeLoad: config.waitForIframeLoad,
    legacyWidgetUrl: config.legacyWidgetUrl,
    widgetData: config.widgetData,
    wrapperUrl: location.origin + location.pathname,
    sendToHost: (m) => parent.postMessage(m, config.clientOrigin),
    sendToWidget: (m) => iframe?.contentWindow?.postMessage(m, widgetOrigin),
    // `url` is absolute http(s), checked by the bridge (url.ts).
    loadWidget: (url) => {
      const inner = innerIframe(url, location.origin);
      widgetOrigin = inner.targetOrigin;
      log.info(`loading the legacy widget from ${new URL(url).origin}${widgetOrigin === "*" ? " (the wrapper's own origin: without allow-same-origin)" : ""}`);
      iframe = document.createElement("iframe");
      iframe.setAttribute("sandbox", inner.sandbox);
      iframe.allow = inner.allow;
      iframe.title = config.widgetName;
      iframe.addEventListener("load", () => bridge.onIframeLoad());
      iframe.src = url;
      container.append(iframe);
    },
    refuseWidget: (reason) => showError(`refused to load the legacy widget: ${reason}`, container),
  });

  window.addEventListener("message", (ev) => {
    if (ev.source === parent) bridge.onHostMessage(ev.data);
    else if (iframe && ev.source === iframe.contentWindow) bridge.onWidgetMessage(ev.data);
  });
  bridge.start();
  return bridge;
}
