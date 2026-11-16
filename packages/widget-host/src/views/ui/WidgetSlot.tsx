import type { ReactNode } from "react";

import type { WidgetInstanceId } from "../../appViewModel";

/** The slot name of a widget's iframe. The iframe carries it as its `slot` attribute for its whole life. */
export const widgetSlotName = (widgetId: WidgetInstanceId) => `widget-${widgetId}`;

/**
 * The place where a running widget is shown.
 *
 * Widgets are iframes, and an iframe reloads when its DOM node is moved. So the iframes are never
 * moved: they are light-DOM children of the app's host element (rendered by `WidgetIframes`), and
 * the whole UI is rendered in that element's shadow root. A `<slot name="widget-<id>">` in the
 * shadow tree is where the iframe is *displayed*; rendering this component somewhere else (a tab
 * body, a PiP box) moves the widget on screen without touching the iframe. While no slot of a
 * widget is rendered, its iframe is not displayed but keeps running.
 *
 * Render at most one slot per widget (the first one in tree order would win).
 *
 * Outside a shadow root (Storybook, tests) a `<slot>` shows its children: pass a stand-in there.
 */
export function WidgetSlot({ widgetId, children }: { widgetId: WidgetInstanceId; children?: ReactNode }) {
  return (
    <slot name={widgetSlotName(widgetId)} data-testid="widget-slot" data-widget-id={widgetId}>
      {children}
    </slot>
  );
}
