import type { DevToolPanel, WidgetDevToolsLayout, WidgetInstanceViewModel } from "../../appViewModel";
import { useDispatch } from "../env";
import { plural } from "../helpers";
import type { IconName } from "../ui/atoms";
import { DevToolsBar, type BarStatus } from "../ui/DevToolsBar";

/** Icon and label of each dev tool panel, in bar order. */
export const DEV_TOOL_PANELS: Record<DevToolPanel, { icon: IconName; label: string }> = {
  messages: { icon: "message", label: "Messages" },
  stats: { icon: "chart", label: "Stats" },
  driver: { icon: "cpu", label: "Driver" },
  console: { icon: "terminal", label: "Console" },
};

const STATUS: Record<WidgetInstanceViewModel["load"]["state"], BarStatus> = {
  sameOrigin: { cls: "wait", label: "Widget waits for “Open”" },
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
 * The bar of the WidgetDevToolBar (the shared `DevToolsBar`): status dot, one toggle per panel,
 * reload, the dock switch and close. stories `widget-devtools--bar-*`
 */
export function DevToolBar({ widget, layout, messageCount, errorCount }: DevToolBarProps) {
  const dispatch = useDispatch();
  const widgetId = widget.id;
  const open = new Set(layout.panels.map((p) => p.panel));
  return (
    <DevToolsBar
      label="Widget dev tools"
      title="Dev tools"
      status={STATUS[widget.load.state]}
      toggles={(Object.keys(DEV_TOOL_PANELS) as DevToolPanel[]).map((panel) => {
        const { icon, label } = DEV_TOOL_PANELS[panel];
        const badge = panel === "messages" ? messageCount : panel === "console" ? errorCount : 0;
        return {
          panel,
          icon,
          label,
          name: !badge ? label : panel === "messages" ? `${label}, ${badge}` : `${label}, ${plural(badge, "error")}`,
          pressed: open.has(panel),
          badge: badge > 0 ? { count: badge, error: panel === "console" } : undefined,
          onToggle: () => dispatch({ type: "devTools/togglePanel", widgetId, panel }),
        };
      })}
      dock={layout.dock}
      onDock={(dock) => dispatch({ type: "devTools/dock", widgetId, dock })}
      before={[{ icon: "refresh", label: "Reload the widget", className: "dt-reload", onClick: () => dispatch({ type: "widget/reload", widgetId }) }]}
      after={[{ icon: "x", label: "Close the dev tools", onClick: () => dispatch({ type: "devTools/toggle", widgetId }) }]}
    />
  );
}
