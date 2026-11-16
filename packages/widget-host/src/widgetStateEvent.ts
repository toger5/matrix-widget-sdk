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
 * The webview capabilities of a legacy widget: the iframe of a legacy client (Element Web's
 * `sandbox` and `allow`, plus `fullscreen`), which the compat wrapper requests when it starts
 * (`LEGACY_WEBVIEW_CAPABILITIES` of `packages/widget-compat-wrapper`; a test compares the two).
 * The iframe of a legacy widget has them from the start, so the request is granted at once, without
 * a prompt and without a reload.
 */
export const LEGACY_WEBVIEW = [
  "webview:org.matrix.mscXXXX.sandbox:allow-forms",
  "webview:org.matrix.mscXXXX.sandbox:allow-popups",
  "webview:org.matrix.mscXXXX.sandbox:allow-popups-to-escape-sandbox",
  "webview:org.matrix.mscXXXX.sandbox:allow-same-origin",
  "webview:org.matrix.mscXXXX.sandbox:allow-scripts",
  "webview:org.matrix.mscXXXX.sandbox:allow-presentation",
  "webview:org.matrix.mscXXXX.sandbox:allow-downloads",
  "webview:org.matrix.mscXXXX.allow:microphone",
  "webview:org.matrix.mscXXXX.allow:camera",
  "webview:org.matrix.mscXXXX.allow:encrypted-media",
  "webview:org.matrix.mscXXXX.allow:autoplay",
  "webview:org.matrix.mscXXXX.allow:display-capture",
  "webview:org.matrix.mscXXXX.allow:clipboard-write",
  "webview:org.matrix.mscXXXX.allow:clipboard-read",
  "webview:org.matrix.mscXXXX.allow:fullscreen",
];

/**
 * Capabilities granted to a legacy widget (behind the compat wrapper) without a prompt, because a
 * legacy client did not ask for them either: the facts it put into the widget URL, the theme,
 * language and visibility updates, and the webview capabilities of its iframe (`LEGACY_WEBVIEW`).
 * Not `get_openid`: a legacy client asked the user per token, and the single-use capability is how
 * this host asks (the wrapper requests it per token).
 */
export const LEGACY_AUTO_APPROVED = [
  "widget:org.matrix.mscXXXX.get_matrix_context",
  "widget:org.matrix.mscXXXX.get_client_context",
  "host:org.matrix.mscXXXX.update_theme",
  "host:org.matrix.mscXXXX.update_language",
  "host:org.matrix.mscXXXX.update_visibility",
  ...LEGACY_WEBVIEW,
];
