/**
 * Widget state events as the host's types and keys. Pure (types and constants only), so views may
 * import it. What an event means is the driver's business: see `src/lib/widgetEvents.ts`.
 */
import type { WidgetDefinition } from "@matrix-widget-sdk/host";

/** The driver's types: a widget as its state event describes it, and the iframe the driver asks for. */
export type { WidgetDefinition, WidgetIframe } from "@matrix-widget-sdk/host";

export interface StateEvent {
  type: string;
  state_key: string;
  content: Record<string, unknown>;
}

/** The driver's widget state event parser with this host's options, as views get it (`ViewEnv.widgetEvents`). */
export interface WidgetEventParser {
  /**
   * The widget `event` describes, with a `problem` if the host must not load it (listed, disabled);
   * `undefined` if it describes none. `sameOrigin`: a page of this host's origin, which asks before it loads.
   */
  resolve(event: StateEvent): { widget: WidgetDefinition; problem?: string; sameOrigin?: true } | undefined;
}

/** Every state event type that describes a widget: `widgetEventTypes()` of the driver (a test compares them). */
export const WIDGET_EVENT_TYPES = ["m.widget", "org.matrix.msc4411.widget", "im.vector.modular.widgets"];

/** Identifies a widget within a room: two event types may use the same state key. */
export const widgetKey = (event: Pick<StateEvent, "type" | "state_key">) => `${event.type}/${event.state_key}`;

/** Identifies a local widget ("Add widget", only in this host): no `widgetKey` starts with `local:`, so it never shares a key with a room widget. */
export const localWidgetKey = (event: Pick<StateEvent, "type" | "state_key">) => `local:${widgetKey(event)}`;
