/**
 * The widget state events of a room, read by the driver's parser (`widget-host-driver`,
 * `parse_widget_state_event` and `embed_widget`): which events describe a widget, and what the
 * host puts into its iframe. The host never templates URLs: a legacy widget's `content.url` goes to
 * the compat wrapper as it is, and the wrapper fills in `$matrix_user_id` & co. itself. The URL
 * check is the driver's too (`embed_url_problem`): absolute http(s), and never a page of the compat
 * wrapper, which this host serves from its own origin.
 *
 * The model and the controller import this module; views get `hostWidgetEvents` as
 * `ViewEnv.widgetEvents` (they must not import the bindings).
 */
import {
  embedUrlProblem,
  embedWidget,
  parseWidgetStateEvent,
  WidgetEventError,
  type WidgetDefinition,
} from "@matrix-widget-tools/widget-host-bindings";

import type { ResolvedWidget, StateEvent, WidgetEventParser, WidgetResolution } from "../widgetStateEvent";

/** MSC4411 allows `http:` widget URLs in developer tools, and this host is one (the test widgets are served from `http://localhost`). */
const ALLOW_HTTP = true;

/** Where legacy widgets are loaded through; the compat wrapper this host serves itself by default (`?wrapper=` overrides). */
export const wrapperUrl = () =>
  new URLSearchParams(globalThis.location?.search ?? "").get("wrapper") ??
  new URL(`${import.meta.env.BASE_URL}widget_compatibility_wrapper/`, globalThis.location?.origin ?? "http://localhost").href;

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

// TODO-FINDING widget-same-origin - only the compat wrapper's directory of the host's origin is refused (the dev site serves its test widgets from the host's origin); other pages of that origin, the host app itself included, load with `allow-same-origin`.
/**
 * Why a URL cannot be loaded as a widget, or `undefined` when it can: only absolute http: and https:
 * URLs, and no page of the compat wrapper at `wrapper` (`embed_url_problem` of the driver, the
 * check `embed_widget` makes).
 */
export const widgetUrlProblem = (url: string, wrapper = wrapperUrl()): string | undefined => embedUrlProblem(url, wrapper, ALLOW_HTTP);

/**
 * `embed_widget` of the definition `parseWidget` returned for `event`. The URL and the widget id go
 * back as the event has them: the bindings decode strings with a default `TextDecoder`, which drops
 * a leading U+FEFF, so the definition's `url` and `widgetId` are not always the event's (and the
 * check must see the event's URL; the compat wrapper gets the event's state key).
 */
function embedded(event: StateEvent, widget: WidgetDefinition, wrapper: string): ResolvedWidget {
  const { url, usesWidgetApi } = embedWidget({ ...widget, url: String(event.content.url), widgetId: event.state_key }, wrapper, ALLOW_HTTP);
  return { url, name: widget.name, legacy: widget.legacy !== undefined, usesWidgetApi };
}

/** What the host puts into the iframe of a widget state event. Throws (with the reason) for an event that is no widget or must not be loaded. */
export function resolveWidget(event: StateEvent, wrapper = wrapperUrl()): ResolvedWidget {
  const parsed = parseWidget(event);
  if ("problem" in parsed) throw new Error(parsed.problem);
  try {
    return embedded(event, parsed.widget, wrapper);
  } catch (e) {
    throw new Error(reasonOf(e));
  }
}

/**
 * The parser for one compat wrapper URL. `resolve` remembers its answer per event object (state
 * events are never changed in place), so a view that renders the widgets of many rooms does not
 * call into the bindings again for the same events.
 */
export function widgetEventParser(wrapper: string): WidgetEventParser {
  const known = new WeakMap<StateEvent, WidgetResolution | null>();
  const resolve = (event: StateEvent): WidgetResolution | undefined => {
    const parsed = parseWidget(event);
    if ("problem" in parsed) return undefined;
    const { name } = parsed.widget;
    try {
      return { name, widget: embedded(event, parsed.widget, wrapper) };
    } catch (e) {
      return { name, problem: reasonOf(e) };
    }
  };
  return {
    resolve(event) {
      if (!known.has(event)) known.set(event, resolve(event) ?? null);
      return known.get(event) ?? undefined;
    },
    urlProblem: (url) => widgetUrlProblem(url, wrapper),
  };
}

/** The parser of this host: its compat wrapper (`wrapperUrl()`, read once). */
export const hostWidgetEvents: WidgetEventParser = widgetEventParser(wrapperUrl());
