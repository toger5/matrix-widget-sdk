/**
 * The driver's widget state event parser (`parse_widget_state_event`, `embed_url_problem`) with
 * what this host says about itself. It tells which events are widgets and whether the host may
 * load them; what goes into the iframe a `WidgetHostDriver` says when the widget runs.
 * Views get `hostWidgetEvents` as `ViewEnv.widgetEvents` (they must not import the bindings).
 */
import { embedUrlProblem, parseWidgetStateEvent, WidgetEventError, type EmbedOptions } from "@matrix-widget-tools/widget-host-bindings";

import { TEST_WIDGETS_URL } from "../exampleWidgets";
import type { StateEvent, WidgetEventParser } from "../widgetStateEvent";

const hostBaseUrl = () => new URL(import.meta.env.BASE_URL, globalThis.location?.origin ?? "http://localhost").href;

/** Where legacy widgets are loaded through: the compat wrapper this host serves itself (`?wrapper=` overrides). */
export const wrapperUrl = () => new URLSearchParams(globalThis.location?.search ?? "").get("wrapper") ?? `${hostBaseUrl()}widget_compatibility_wrapper/`;

/**
 * The test widgets this host ships itself: the one exception to "no widget on this host's origin"
 * (the dev site serves them there). A directory that holds this host itself is no exception.
 */
export const ownWidgetDirs = (hostBase = hostBaseUrl(), dir = TEST_WIDGETS_URL): string[] => (hostBase.startsWith(new URL("./", dir).href) ? [] : [dir]);

/** What the driver gets about this host. `allowHttp`: MSC4411 allows `http:` in developer tools, and the test widgets are on `http://localhost`. */
export const embedOptions = (wrapper = wrapperUrl(), clientOrigin = globalThis.location?.origin): EmbedOptions => ({
  wrapperUrl: wrapper,
  clientOrigin,
  ownWidgetDirs: ownWidgetDirs(),
  allowHttp: true,
});

/** The text of an error of the parser or the driver's constructor (the classes carry the reason, not the Rust message). */
export function reasonOf(e: unknown): string {
  if (WidgetEventError.Refused.instanceOf(e) || WidgetEventError.Removed.instanceOf(e)) return e.inner.reason;
  return e instanceof Error ? e.message : String(e);
}

/** The parser for `options`. `resolve` remembers its answer per event object (state events are never changed in place). */
export function widgetEventParser(options = embedOptions()): WidgetEventParser {
  type Resolution = ReturnType<WidgetEventParser["resolve"]>;
  const known = new WeakMap<StateEvent, Resolution>();
  // The URL and the widget id as the event has them: the bindings drop a leading U+FEFF of a string
  // they return, and the driver made from the definition must check the event's URL.
  const own = (event: StateEvent) => ({ url: String(event.content.url), widgetId: event.state_key });
  const resolve = (event: StateEvent): Resolution => {
    try {
      return { widget: { ...parseWidgetStateEvent(event.type, event.state_key, event.content, options), ...own(event) } };
    } catch (e) {
      return WidgetEventError.Refused.instanceOf(e) ? { widget: { ...e.inner.widget, ...own(event) }, problem: e.inner.reason } : undefined;
    }
  };
  return {
    resolve(event) {
      if (!known.has(event)) known.set(event, resolve(event));
      return known.get(event);
    },
    urlProblem: (url) => embedUrlProblem(url, options),
  };
}

/** The parser of this host. */
export const hostWidgetEvents = widgetEventParser();

/** Whether a state event describes a widget: removing one leaves an event without a `url` (or, MSC4411, a `name`) behind. */
export const describesWidget = (event: StateEvent) => hostWidgetEvents.resolve(event) !== undefined;
