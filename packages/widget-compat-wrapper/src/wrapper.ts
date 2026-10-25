/** Browser glue: read the configuration from the URL, create the inner iframe, route messages. */
import { CompatBridge } from "./bridge";

export interface WrapperConfig {
  /** Untemplated legacy widget URL. */
  legacyWidgetUrl: string;
  widgetId: string;
  waitForIframeLoad: boolean;
  widgetData?: Record<string, unknown>;
  clientOrigin: string;
}

export function parseConfig(params: URLSearchParams): WrapperConfig {
  const legacyWidgetUrl = params.get("legacy_widget_url");
  if (!legacyWidgetUrl) throw new Error("missing `legacy_widget_url` query parameter");
  const widgetId = params.get("legacy_widget_id") ?? new URL(legacyWidgetUrl).searchParams.get("widgetId");
  if (!widgetId) throw new Error("missing `legacy_widget_id` (and no `widgetId` in the legacy url)");
  const data = params.get("legacy_widget_data");
  return {
    legacyWidgetUrl,
    widgetId,
    waitForIframeLoad: params.get("legacy_wait_for_iframe_load") !== "false",
    widgetData: data ? (JSON.parse(data) as Record<string, unknown>) : undefined,
    clientOrigin: params.get("client_origin") ?? "*",
  };
}

export function startWrapper(config: WrapperConfig, container: HTMLElement, parent: Window = window.parent): CompatBridge {
  const iframe = document.createElement("iframe");
  iframe.allow = "camera; microphone; display-capture; autoplay; clipboard-write";
  let widgetOrigin = "*";

  const bridge = new CompatBridge({
    widgetId: config.widgetId,
    waitForIframeLoad: config.waitForIframeLoad,
    legacyWidgetUrl: config.legacyWidgetUrl,
    widgetData: config.widgetData,
    wrapperUrl: location.origin + location.pathname,
    sendToHost: (m) => parent.postMessage(m, config.clientOrigin),
    sendToWidget: (m) => iframe.contentWindow?.postMessage(m, widgetOrigin),
    loadWidget: (url) => {
      widgetOrigin = new URL(url).origin;
      iframe.src = url;
      container.append(iframe);
    },
  });

  iframe.addEventListener("load", () => bridge.onIframeLoad());
  window.addEventListener("message", (ev) => {
    if (ev.source === parent) bridge.onHostMessage(ev.data);
    else if (ev.source === iframe.contentWindow) bridge.onWidgetMessage(ev.data);
  });
  bridge.start();
  return bridge;
}
