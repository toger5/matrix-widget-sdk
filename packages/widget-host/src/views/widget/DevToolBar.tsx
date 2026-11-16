import { useState, type KeyboardEvent } from "react";

import { sideDock, type DevToolPanel, type WidgetDevToolsLayout, type WidgetInstanceViewModel } from "../../appViewModel";
import { useDispatch } from "../env";
import { plural } from "../helpers";
import { Icon, type IconName } from "../ui/atoms";

/** Icon and label of each dev tool panel, in bar order. */
export const DEV_TOOL_PANELS: Record<DevToolPanel, { icon: IconName; label: string }> = {
  messages: { icon: "message", label: "Messages" },
  stats: { icon: "chart", label: "Stats" },
  driver: { icon: "cpu", label: "Driver" },
  console: { icon: "terminal", label: "Console" },
};

const DOCKS = [
  { dock: "left", icon: "dockLeft" },
  { dock: "top", icon: "dockTop" },
  { dock: "bottom", icon: "dockBottom" },
  { dock: "right", icon: "dockRight" },
] as const satisfies readonly { dock: WidgetDevToolsLayout["dock"]; icon: IconName }[];

const STATUS: Record<WidgetInstanceViewModel["load"]["state"], { cls: string; label: string }> = {
  ready: { cls: "ok", label: "Widget is ready" },
  loading: { cls: "wait", label: "Widget is loading" },
  failed: { cls: "err", label: "Widget failed to load" },
};

export interface DevToolBarProps {
  widget: WidgetInstanceViewModel;
  layout: WidgetDevToolsLayout;
  /** Number of logged messages: the badge of the Messages button. */
  messageCount: number;
  /** Number of console lines of level "error": the badge of the Console button. */
  errorCount: number;
}

/**
 * The bar of the WidgetDevToolBar: status dot, one toggle per panel, reload, the dock switch and close.
 * A toolbar with a roving tabindex: Tab enters it once, the arrow keys move between its buttons.
 * stories `widget-devtools--bar-*`
 */
export function DevToolBar({ widget, layout, messageCount, errorCount }: DevToolBarProps) {
  const dispatch = useDispatch();
  const widgetId = widget.id;
  const vertical = sideDock(layout.dock);
  const open = new Set(layout.panels.map((p) => p.panel));
  const status = STATUS[widget.load.state];
  // Which button of the bar is the tab stop (index in DOM order).
  const [stop, setStop] = useState(0);
  let index = 0;
  const roving = () => {
    const i = index++;
    return { tabIndex: i === stop ? 0 : -1, onFocus: () => setStop(i) };
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const at = buttons.indexOf(e.target as HTMLButtonElement);
    if (at < 0) return;
    const [prev, next] = vertical ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
    const to = e.key === next ? at + 1 : e.key === prev ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : undefined;
    if (to === undefined) return;
    e.preventDefault();
    buttons[(to + buttons.length) % buttons.length].focus();
  };

  return (
    <div className="dt-bar" role="toolbar" aria-label="Widget dev tools" aria-orientation={vertical ? "vertical" : "horizontal"} onKeyDown={onKeyDown}>
      <span className="dt-title">
        {/* TODO-FINDING tooltip-component - tooltips are `title` attributes as designed; a keyboard user never sees them (designFeedback "Later": use a tooltip component) */}
        <i className={`dot ${status.cls}`} role="img" aria-label={status.label} title={status.label} />
        <span>Dev tools</span>
      </span>
      {(Object.keys(DEV_TOOL_PANELS) as DevToolPanel[]).map((panel) => {
        const { icon, label } = DEV_TOOL_PANELS[panel];
        const badge = panel === "messages" ? messageCount : panel === "console" ? errorCount : 0;
        const name = !badge ? label : panel === "messages" ? `${label}, ${badge}` : `${label}, ${plural(badge, "error")}`;
        return (
          <button
            key={panel}
            type="button"
            className={`dt-btn ${open.has(panel) ? "on" : ""}`}
            aria-pressed={open.has(panel)}
            title={label}
            aria-label={name}
            data-dev-panel={panel}
            onClick={() => dispatch({ type: "devTools/togglePanel", widgetId, panel })}
            {...roving()}
          >
            <Icon name={icon} size={13} />
            <span>{label}</span>
            {badge > 0 && panel === "messages" && <em>{badge}</em>}
            {badge > 0 && panel === "console" && (
              <em className="err">
                <Icon name="alert" size={9} />
                {badge}
              </em>
            )}
          </button>
        );
      })}
      <span className="sp" />
      <button type="button" className="dt-ib dt-reload" title="Reload the widget" aria-label="Reload the widget" onClick={() => dispatch({ type: "widget/reload", widgetId })} {...roving()}>
        <Icon name="refresh" size={13} />
      </button>
      <span className="dt-dock" role="radiogroup" aria-label="Dock position">
        {DOCKS.map(({ dock, icon }) => (
          <button
            key={dock}
            type="button"
            role="radio"
            className={`dt-ib ${dock === layout.dock ? "on" : ""}`}
            title={`Dock to the ${dock}`}
            aria-label={`Dock to the ${dock}`}
            aria-checked={dock === layout.dock}
            onClick={() => dispatch({ type: "devTools/dock", widgetId, dock })}
            {...roving()}
          >
            <Icon name={icon} size={13} />
          </button>
        ))}
      </span>
      <button type="button" className="dt-ib" title="Close the dev tools" aria-label="Close the dev tools" onClick={() => dispatch({ type: "devTools/toggle", widgetId })} {...roving()}>
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}
