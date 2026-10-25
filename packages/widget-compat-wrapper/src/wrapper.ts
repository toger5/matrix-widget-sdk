/** Browser glue: read the configuration from the URL, create the inner iframe, route messages. */
import { CompatBridge } from "./bridge";

export interface WrapperConfig {
  legacyWidgetUrl: string;
  widgetId: string;
  waitForIframeLoad: boolean;
  clientOrigin: string;
}

export function parseConfig(params: URLSearchParams, wrapperUrl: string = location.origin + location.pathname): WrapperConfig {
  const rawUrl = params.get("legacy_widget_url");
  if (!rawUrl) throw new Error("missing `legacy_widget_url` query parameter");
  const url = new URL(rawUrl);
  const widgetId = params.get("legacy_widget_id") ?? url.searchParams.get("widgetId");
  if (!widgetId) throw new Error("missing `legacy_widget_id` (and no `widgetId` in the legacy url)");
  // Legacy widgets derive the origin they postMessage to from `parentUrl`. Their parent is now
  // the wrapper, so point it here instead of at the host.
  if (url.searchParams.has("parentUrl")) url.searchParams.set("parentUrl", wrapperUrl);
  return {
    legacyWidgetUrl: url.toString(),
    widgetId,
    waitForIframeLoad: params.get("legacy_wait_for_iframe_load") !== "false",
    clientOrigin: params.get("client_origin") ?? "*",
  };
}

export function startWrapper(config: WrapperConfig, container: HTMLElement, parent: Window = window.parent): CompatBridge {
  const iframe = document.createElement("iframe");
  iframe.src = config.legacyWidgetUrl;
  iframe.allow = "camera; microphone; display-capture; autoplay; clipboard-write";
  const widgetOrigin = new URL(config.legacyWidgetUrl).origin;

  const bridge = new CompatBridge({
    widgetId: config.widgetId,
    waitForIframeLoad: config.waitForIframeLoad,
    sendToHost: (m) => parent.postMessage(m, config.clientOrigin),
    sendToWidget: (m) => iframe.contentWindow?.postMessage(m, widgetOrigin),
  });

  iframe.addEventListener("load", () => bridge.onIframeLoad());
  window.addEventListener("message", (ev) => {
    if (ev.source === parent) bridge.onHostMessage(ev.data);
    else if (ev.source === iframe.contentWindow) bridge.onWidgetMessage(ev.data);
  });
  container.append(iframe);
  return bridge;
}
