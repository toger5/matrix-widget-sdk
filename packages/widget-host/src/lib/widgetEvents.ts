/**
 * The widget state events of a room, read by the driver's parser (`widget-host-driver`,
 * `parse_widget_state_event` and `embed_widget`): which events describe a widget, and what the
 * host puts into its iframe. The host never templates URLs: a legacy widget's `content.url` goes to
 * the compat wrapper as it is, and the wrapper fills in `$matrix_user_id` & co. itself. The URL
 * check is the driver's too (`embed_url_problem`): absolute http(s), never a page of the compat
 * wrapper, which this host serves from its own origin, and never another page of this host's
 * origin, except the test widgets it ships itself (`ownWidgetDirs`, the dev site): every widget
 * iframe has `allow-same-origin`, which would give such a page this host's origin.
 *
 * The model and the controller import this module; views get `hostWidgetEvents` as
 * `ViewEnv.widgetEvents` (they must not import the bindings).
 */
import {
  embedUrlProblem,
  embedWidget,
  parseWidgetStateEvent,
  WidgetEventError,
  type EmbedOptions,
  type WidgetDefinition,
} from "@matrix-widget-tools/widget-host-bindings";

import { TEST_WIDGETS_URL } from "../exampleWidgets";
import type { ResolvedWidget, StateEvent, WidgetEventParser, WidgetResolution } from "../widgetStateEvent";

/** MSC4411 allows `http:` widget URLs in developer tools, and this host is one (the test widgets are served from `http://localhost`). */
const ALLOW_HTTP = true;

/** Where legacy widgets are loaded through; the compat wrapper this host serves itself by default (`?wrapper=` overrides). */
export const wrapperUrl = () =>
  new URLSearchParams(globalThis.location?.search ?? "").get("wrapper") ??
  new URL(`${import.meta.env.BASE_URL}widget_compatibility_wrapper/`, globalThis.location?.origin ?? "http://localhost").href;

/**
 * The directories of the widgets this host ships itself: the test widgets (`TEST_WIDGETS_URL`), which
 * the dev site serves from this host's origin (`VITE_TEST_WIDGETS_URL`), the one exception to "no widget
 * on this host's origin". A deliberate hole for a developer tool: they run this repository's code, but
 * in an iframe with `allow-same-origin` they share this host's origin. A directory that holds this host
 * itself is no exception. `hostBase`: this host's base URL.
 */
export function ownWidgetDirs(hostBase = new URL(import.meta.env.BASE_URL, globalThis.location?.origin ?? "http://localhost").href, dir = TEST_WIDGETS_URL): string[] {
  return hostBase.startsWith(new URL("./", dir).href) ? [] : [dir];
}

/** What the driver's URL check gets about this host: its compat wrapper, its origin (`location.origin`, none outside a browser), its own widgets. */
export const embedOptions = (wrapper = wrapperUrl(), clientOrigin = globalThis.location?.origin): EmbedOptions => ({
  wrapperUrl: wrapper,
  clientOrigin,
  ownWidgetDirs: ownWidgetDirs(),
  allowHttp: ALLOW_HTTP,
});

/** The text of an error of the parser (its classes carry the reason, not the message of the Rust error). */
function reasonOf(e: unknown): string {
  if (WidgetEventError.instanceOf(e)) {
    if (WidgetEventError.Refused.instanceOf(e)) return e.inner.reason;
    if (WidgetEventError.Removed.instanceOf(e)) return e.inner.reason;
    if (WidgetEventError.NotAWidgetType.instanceOf(e)) return `${e.inner.eventType} is not a widget state event type`;
  }
  return e instanceof Error ? e.message : String(e);
}

/** The widget a state event describes, or why it describes none (another event type, a removed widget: "the content has no name"). */
export function parseWidget(event: StateEvent): { widget: WidgetDefinition } | { problem: string } {
  try {
    return { widget: parseWidgetStateEvent(event.type, event.state_key, event.content) };
  } catch (e) {
    return { problem: reasonOf(e) };
  }
}

/** Whether a widget state event describes a widget: removing a widget leaves an event without a `url` (or, MSC4411, a `name`) behind. */
export const describesWidget = (event: StateEvent) => "widget" in parseWidget(event);

/**
 * Why a URL cannot be loaded as a widget, or `undefined` when it can: only absolute http: and https:
 * URLs, no page of the compat wrapper, no other page of this host's origin but its own widgets
 * (`embed_url_problem` of the driver with `options`, the check `embed_widget` makes).
 */
export const widgetUrlProblem = (url: string, options: EmbedOptions | string = embedOptions()): string | undefined =>
  embedUrlProblem(url, typeof options === "string" ? embedOptions(options) : options);

/**
 * `embed_widget` of the definition `parseWidget` returned for `event`. The URL and the widget id go
 * back as the event has them: the bindings decode strings with a default `TextDecoder`, which drops
 * a leading U+FEFF, so the definition's `url` and `widgetId` are not always the event's (and the
 * check must see the event's URL; the compat wrapper gets the event's state key).
 */
function embedded(event: StateEvent, widget: WidgetDefinition, options: EmbedOptions): ResolvedWidget {
  const { url, usesWidgetApi } = embedWidget({ ...widget, url: String(event.content.url), widgetId: event.state_key }, options);
  return { url, name: widget.name, legacy: widget.legacy !== undefined, usesWidgetApi };
}

/**
 * What the host puts into the iframe of a widget state event. Throws (with the reason) for an event
 * that is no widget or must not be loaded. `options`: `embedOptions()`, or the compat wrapper's URL
 * for those of this host with that wrapper.
 */
export function resolveWidget(event: StateEvent, options: EmbedOptions | string = embedOptions()): ResolvedWidget {
  const parsed = parseWidget(event);
  if ("problem" in parsed) throw new Error(parsed.problem);
  try {
    return embedded(event, parsed.widget, typeof options === "string" ? embedOptions(options) : options);
  } catch (e) {
    throw new Error(reasonOf(e));
  }
}

/**
 * The parser for one set of options (`embedOptions()`; a string is the compat wrapper's URL). `resolve`
 * remembers its answer per event object (state events are never changed in place), so a view that
 * renders the widgets of many rooms does not call into the bindings again for the same events.
 */
export function widgetEventParser(options: EmbedOptions | string): WidgetEventParser {
  const embed = typeof options === "string" ? embedOptions(options) : options;
  const known = new WeakMap<StateEvent, WidgetResolution | null>();
  const resolve = (event: StateEvent): WidgetResolution | undefined => {
    const parsed = parseWidget(event);
    if ("problem" in parsed) return undefined;
    const { name } = parsed.widget;
    try {
      return { name, widget: embedded(event, parsed.widget, embed) };
    } catch (e) {
      return { name, problem: reasonOf(e) };
    }
  };
  return {
    resolve(event) {
      if (!known.has(event)) known.set(event, resolve(event) ?? null);
      return known.get(event) ?? undefined;
    },
    urlProblem: (url) => widgetUrlProblem(url, embed),
  };
}

/** The parser of this host: its compat wrapper (`wrapperUrl()`, read once), its origin, its own widgets. */
export const hostWidgetEvents: WidgetEventParser = widgetEventParser(embedOptions());
