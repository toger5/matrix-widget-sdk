import { Fragment, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";

import { sideDock, type DevToolPanel, type WidgetDevToolsLayout, type WidgetInstanceViewModel } from "../../appViewModel";
import { useDispatch, useViewEnv } from "../env";
import { Icon, IconButton } from "../ui/atoms";
import { ConsolePanel } from "./ConsolePanel";
import { DEV_TOOL_PANELS, DevToolBar } from "./DevToolBar";
import { DriverPanel } from "./DriverPanel";
import { MessagesPanel } from "./MessagesPanel";
import { StatsPanel } from "./StatsPanel";

/** The smallest panel area, and what "reset" (double click, Enter) goes back to. */
const MIN_SIZE = 80;
// TODO-FINDING devtools-default-size - "reset on double click" needs the default size of the panel area; it is not in the view model (fixtures use 240 / 360, the mockups 250 / 340). The view resets to these constants
const DEFAULT_SIZE = { top: 240, side: 360 };
/** What the widget keeps at least, next to the bar (30px) and the separator (8px). */
const MIN_WIDGET = 48;
/** A panel keeps at least this share (in %) of the two panels a separator divides. */
const MIN_SHARE = 15;

const RESIZE_TITLE = "Drag or use the arrow keys to resize · double click or Enter to reset";

interface SeparatorProps {
  className: string;
  /** Of the separator line itself (ARIA): a vertical line is moved horizontally. */
  orientation: "horizontal" | "vertical";
  label: string;
  value: number;
  min: number;
  max: number;
  /** Arrow key step, in units of `value`. */
  step: number;
  valueText?: string;
  /** -1: moving the separator right / down makes the value smaller (dev tools docked right or bottom). */
  sign?: 1 | -1;
  /** Units of `value` per pixel of drag, measured when the drag starts. */
  unitsPerPx: () => number;
  onChange: (value: number) => void;
  onReset: () => void;
  children?: ReactNode;
}

/** A focusable window splitter: drag, arrow keys, Home / End, Enter or double click to reset. */
function Separator({ className, orientation, label, value, min, max, step, valueText, sign = 1, unitsPerPx, onChange, onReset, children }: SeparatorProps) {
  const drag = useRef<{ at: number; value: number; scale: number } | undefined>(undefined);
  const horizontalMove = orientation === "vertical";
  const clamp = (v: number) => Math.round(Math.min(Math.max(min, max), Math.max(min, v)));
  const position = (e: PointerEvent) => (horizontalMove ? e.clientX : e.clientY);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { at: position(e), value, scale: unitsPerPx() };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const next = clamp(d.value + (position(e) - d.at) * d.scale * sign);
    if (next !== value) onChange(next);
  };
  const onPointerUp = () => {
    drag.current = undefined;
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const more = horizontalMove ? "ArrowRight" : "ArrowDown";
    const less = horizontalMove ? "ArrowLeft" : "ArrowUp";
    let next: number | undefined;
    if (e.key === more) next = clamp(value + step * sign);
    else if (e.key === less) next = clamp(value - step * sign);
    else if (e.key === "Home") next = min;
    else if (e.key === "End") next = clamp(max);
    else if (e.key === "Enter") {
      e.preventDefault();
      onReset();
      return;
    } else return;
    e.preventDefault();
    if (next !== value) onChange(next);
  };

  return (
    <div
      className={className}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={clamp(value)}
      aria-valuemin={min}
      aria-valuemax={Math.max(min, Math.round(max))}
      aria-valuetext={valueText}
      tabIndex={0}
      title={RESIZE_TITLE}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}

/**
 * The size of an element's parent along one axis, kept up to date. Measured before the first paint:
 * a ResizeObserver reports one frame later, and until then the separator's maximum is the current size.
 */
function useParentLength(ref: RefObject<HTMLElement | null>, axis: "width" | "height"): number | undefined {
  const [length, setLength] = useState<number | undefined>();
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const measure = () => setLength(parent.getBoundingClientRect()[axis]);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [ref, axis]);
  return length;
}

export interface DevToolsProps {
  widget: WidgetInstanceViewModel;
  layout: WidgetDevToolsLayout;
  /** Story only: the message of the MessagesPanel that starts expanded. */
  initialExpandedMessage?: string;
}

/**
 * The WidgetDevToolBar of one widget: the bar, the open panels next to each other (stacked when
 * docked to a side) and the separator towards the widget. Rendered by `WidgetView` at the dock
 * position; the bar is at the outer edge. leaves devtools/*
 */
export function DevTools({ widget, layout, initialExpandedMessage }: DevToolsProps) {
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
  /** The separator after panel `i` moves the border between panel `i` and `i + 1`; its value is the percentage panel `i` has of both. */
  const setPair = (i: number, percent: number) => {
    const pair = shares[i] + shares[i + 1];
    const next = [...shares];
    next[i] = (pair * percent) / 100;
    next[i + 1] = pair - next[i];
    dispatch({ type: "devTools/resize", widgetId, shares: next });
  };
  const pairPx = (i: number) => {
    const els = panelsRef.current?.querySelectorAll<HTMLElement>(":scope > .dt-panel");
    const length = (el?: HTMLElement) => (el ? el.getBoundingClientRect()[vertical ? "height" : "width"] : 0);
    return length(els?.[i]) + length(els?.[i + 1]);
  };

  const body = (panel: DevToolPanel): ReactNode => {
    switch (panel) {
      case "messages":
        return <MessagesPanel widgetId={widgetId} messages={data.messages} initialExpanded={initialExpandedMessage} />;
      case "stats":
        return <StatsPanel stats={data.stats} />;
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
                    <Separator
                      className="dt-split"
                      orientation={vertical ? "horizontal" : "vertical"}
                      label={`Resize the dev tool panels ${label} and ${DEV_TOOL_PANELS[next.panel].label}`}
                      value={(share / (share + next.share)) * 100}
                      min={MIN_SHARE}
                      max={100 - MIN_SHARE}
                      step={5}
                      valueText={`${label} ${Math.round((share / (share + next.share)) * 100)} %`}
                      unitsPerPx={() => 100 / Math.max(1, pairPx(i))}
                      onChange={(percent) => setPair(i, percent)}
                      onReset={() => setPair(i, 50)}
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
