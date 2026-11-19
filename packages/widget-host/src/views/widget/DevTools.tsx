import { Fragment, useRef, type ReactNode } from "react";

import { sideDock, type DevToolPanel, type WidgetDevToolsLayout, type WidgetInstanceViewModel } from "../../appViewModel";
import { useDispatch, useViewEnv } from "../env";
import { Icon, IconButton } from "../ui/atoms";
import { PanelSplit, Separator, pairLength, useParentLength } from "../ui/Separator";
import { ConsolePanel } from "./ConsolePanel";
import { DEV_TOOL_PANELS, DevToolBar } from "./DevToolBar";
import { DriverPanel } from "./DriverPanel";
import { MessagesPanel } from "./MessagesPanel";
import { StatsPanel, type StatsSeries } from "./StatsPanel";

/** The smallest panel area, and what "reset" (double click, Enter) goes back to. */
const MIN_SIZE = 80;
// TODO-FINDING devtools-default-size - "reset on double click" needs the default size of the panel area; it is not in the view model (fixtures use 240 / 360, the design 250 / 340). The view resets to these constants
const DEFAULT_SIZE = { top: 240, side: 360 };
/** What the widget keeps at least, next to the bar (30px) and the separator (8px). */
const MIN_WIDGET = 48;

export interface DevToolsProps {
  widget: WidgetInstanceViewModel;
  layout: WidgetDevToolsLayout;
  /** Story only: the message of the MessagesPanel that starts expanded. */
  initialExpandedMessage?: string;
  /** Story only: the graph the StatsPanel shows first. */
  initialStatsSeries?: StatsSeries;
}

/**
 * The WidgetDevToolBar of one widget: the bar, the open panels next to each other (stacked when
 * docked to a side) and the separator towards the widget. Rendered by `WidgetView` at the dock
 * position; the bar is at the outer edge. stories `widget-devtools--*`
 */
export function DevTools({ widget, layout, initialExpandedMessage, initialStatsSeries }: DevToolsProps) {
  const dispatch = useDispatch();
  const data = useViewEnv().useDevToolsData(widget.id);
  const widgetId = widget.id;
  const { dock, panels } = layout;
  const vertical = sideDock(dock);
  const root = useRef<HTMLDivElement>(null);
  const panelsRef = useRef<HTMLDivElement>(null);

  const available = useParentLength(root, vertical ? "width" : "height");
  const size = vertical ? layout.size.side : layout.size.top;
  const maxSize = available === undefined ? Math.max(size, MIN_SIZE) : Math.max(MIN_SIZE, available - 30 - 8 - MIN_WIDGET);

  const shares = panels.map((p) => p.share);
  const body = (panel: DevToolPanel): ReactNode => {
    switch (panel) {
      case "messages":
        return <MessagesPanel widgetId={widgetId} messages={data.messages} initialExpanded={initialExpandedMessage} />;
      case "stats":
        return <StatsPanel stats={data.stats} initialSeries={initialStatsSeries} />;
      case "driver":
        return <DriverPanel widgetId={widgetId} capabilities={data.capabilities} />;
      case "console":
        return <ConsolePanel widgetId={widgetId} lines={data.console} />;
    }
  };

  return (
    <div className={`dt dt-${dock}`} ref={root} data-testid="widget-dev-tools">
      <DevToolBar widget={widget} layout={layout} messageCount={data.messages.length} errorCount={data.console.filter((l) => l.level === "error").length} />
      {panels.length > 0 && (
        <>
          <div className="dt-panels" ref={panelsRef} style={{ [vertical ? "width" : "height"]: Math.max(MIN_SIZE, size) }}>
            {panels.map(({ panel, share }, i) => {
              const { icon, label } = DEV_TOOL_PANELS[panel];
              const next = panels[i + 1];
              return (
                <Fragment key={panel}>
                  <section className={`dt-panel dtp-${panel}`} style={{ flexGrow: share }} aria-label={label} data-dev-panel={panel}>
                    <header className="dt-ph">
                      <Icon name={icon} size={12} />
                      <span>{label}</span>
                      <span className="sp" />
                      <IconButton icon="x" title={`Close ${label}`} className="xs" onClick={() => dispatch({ type: "devTools/togglePanel", widgetId, panel })} />
                    </header>
                    <div className="dt-pb">{body(panel)}</div>
                  </section>
                  {next && (
                    <PanelSplit
                      i={i}
                      shares={shares}
                      vertical={vertical}
                      label={`Resize the dev tool panels ${label} and ${DEV_TOOL_PANELS[next.panel].label}`}
                      valueLabel={label}
                      pairPx={() => pairLength(panelsRef.current, i, vertical)}
                      onShares={(next) => dispatch({ type: "devTools/resize", widgetId, shares: next })}
                    />
                  )}
                </Fragment>
              );
            })}
          </div>
          <Separator
            className="dt-resize"
            orientation={vertical ? "vertical" : "horizontal"}
            label="Resize the dev tools"
            value={Math.min(size, maxSize)}
            min={MIN_SIZE}
            max={maxSize}
            step={16}
            valueText={`${Math.round(Math.min(size, maxSize))} pixels`}
            sign={dock === "right" || dock === "bottom" ? -1 : 1}
            unitsPerPx={() => 1}
            onChange={(next) => dispatch({ type: "devTools/resize", widgetId, size: next })}
            onReset={() => dispatch({ type: "devTools/resize", widgetId, size: Math.min(maxSize, vertical ? DEFAULT_SIZE.side : DEFAULT_SIZE.top) })}
          >
            <i />
          </Separator>
        </>
      )}
    </div>
  );
}
