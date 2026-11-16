/**
 * Widget state events as the host's types, keys and constants. Pure: views may import it.
 *
 * What an event means is decided by the driver's parser (`parse_widget_state_event` and
 * `embed_widget` of `widget-host-driver`): which events describe a widget, the URL check, how a
 * legacy widget is loaded through the compat wrapper. The model and the controller use it through
 * `src/lib/widgetEvents.ts`; views get it as `ViewEnv.widgetEvents` (a `WidgetEventParser`).
 */

export interface StateEvent {
  type: string;
  state_key: string;
  content: Record<string, unknown>;
}

/** What the host puts into a widget's iframe: `embed_widget` of the driver, with the widget's name. */
export interface ResolvedWidget {
  url: string;
  name: string;
  /** Loaded through the compat wrapper (`im.vector.modular.widgets`). */
  legacy: boolean;
  /** `uses_widget_api` (MSC4412): set up the widget API and hide the iframe until `notify_ready` arrives. Always for a legacy widget. */
  usesWidgetApi: boolean;
}

/** A state event that describes a widget: its name, and what to load (`widget`) or why it must not be loaded (`problem`). */
export interface WidgetResolution {
  name: string;
  widget?: ResolvedWidget;
  problem?: string;
}

/** The driver's widget state event parser, as views get it (`ViewEnv.widgetEvents`). */
export interface WidgetEventParser {
  /** The widget a state event describes, or `undefined` when it describes none (another event type, a removed widget). */
  resolve(event: StateEvent): WidgetResolution | undefined;
  /** Why a URL cannot be loaded as a widget, or `undefined` when it can (the check in front of every widget iframe, including "not the compat wrapper"). */
  urlProblem(url: string): string | undefined;
}

/** Every state event type that describes a widget, the MSC4411 ones first: `widgetEventTypes()` of the driver (a test compares them). */
export const WIDGET_EVENT_TYPES = ["m.widget", "org.matrix.msc4411.widget", "im.vector.modular.widgets"];

/** Identifies a widget within a room: two event types may use the same state key. */
export const widgetKey = (event: Pick<StateEvent, "type" | "state_key">) => `${event.type}/${event.state_key}`;

/** The prefix of `localWidgetKey`. */
export const LOCAL_WIDGET_PREFIX = "local:";

/**
 * Identifies a local widget ("Add widget", only in this host) within a room: `local:` before its
 * `widgetKey`. No `widgetKey` starts with it (it starts with one of `WIDGET_EVENT_TYPES`), so a
 * local widget never shares its key (its instance id, its remembered capabilities) with a room widget.
 */
export const localWidgetKey = (event: Pick<StateEvent, "type" | "state_key">) => `${LOCAL_WIDGET_PREFIX}${widgetKey(event)}`;

/**
 * Capabilities granted to a legacy widget (behind the compat wrapper) without a prompt, because a
 * legacy client did not ask for them either: the facts it put into the widget URL, the theme,
 * language and visibility updates, and asking for an OpenID token (which still asks per request).
 */
export const LEGACY_AUTO_APPROVED = [
  "widget:org.matrix.mscXXXX.get_matrix_context",
  "widget:org.matrix.mscXXXX.get_client_context",
  "widget:org.matrix.mscXXXX.get_openid",
  "host:org.matrix.mscXXXX.update_theme",
  "host:org.matrix.mscXXXX.update_language",
  "host:org.matrix.mscXXXX.update_visibility",
];
