/**
 * The bar of the dev tools, shared by the WidgetDevToolBar (`../widget/DevToolBar.tsx`) and the room
 * dev tools (`../devbackend/RoomDevTools.tsx`): the status dot, a toggle per panel, optional buttons,
 * the dock switch. stories `widget-devtools--bar-*`, `rooms-roomdevtools--*`
 */
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";

import { sideDock, type WidgetDevToolsLayout } from "../../appViewModel";
import { Icon, type IconName } from "./atoms";

export type Dock = WidgetDevToolsLayout["dock"];

/** The dock switch, in bar order. */
export const DOCKS = [
  { dock: "left", icon: "dockLeft" },
  { dock: "top", icon: "dockTop" },
  { dock: "bottom", icon: "dockBottom" },
  { dock: "right", icon: "dockRight" },
] as const satisfies readonly { dock: Dock; icon: IconName }[];

/** The status dot: its color and what it says. */
export interface BarStatus {
  cls: "ok" | "wait" | "err";
  label: string;
}

/** A toggle of the bar: a panel, pressed while it is open. */
interface BarToggle {
  /** `data-dev-panel`, and the React key. */
  panel: string;
  icon: IconName;
  label: string;
  /** The accessible name (the label with what the badge says: "Messages, 12"). */
  name: string;
  pressed: boolean;
  /** The badge after the label: a number, or (`error`) the alert badge, with the number if there is one. None: no badge. */
  badge?: { count?: number; error?: boolean };
  onToggle: () => void;
}

/** A button of the bar that is no toggle: the widget's reload (before the dock switch) and close (after it). */
interface BarButton {
  icon: IconName;
  label: string;
  className?: string;
  onClick: () => void;
}

export interface DevToolsBarProps {
  /** The name of the toolbar ("Widget dev tools", "Room dev tools"). */
  label: string;
  /** The text next to the dot, shown with the labels of a horizontal bar. */
  title: string;
  status: BarStatus;
  toggles: BarToggle[];
  dock: Dock;
  onDock: (dock: Dock) => void;
  /** Between the toggles and the dock switch. */
  before?: BarButton[];
  /** After the dock switch. */
  after?: BarButton[];
}

/** Room for rounding: the labels stay as long as they need at most this much more than the bar has. */
const SLACK = 1;

/**
 * Whether the labelled toggles do not fit the bar (`dt-compact`: icons and badges only). The length
 * the labels add is measured while they are shown and remembered, so the bar decides on the length
 * it would need with them also while they are hidden, and does not flip back and forth. Measured
 * before paint, again after every render (a badge grows) and when the bar or a toggle changes size.
 */
function useCompact(ref: RefObject<HTMLDivElement | null>, vertical: boolean): boolean {
  const [compact, setCompact] = useState(false);
  /** What the labels (and the gap before each) add to the bar, measured while they were shown. */
  const labels = useRef(0);
  const compactRef = useRef(compact);
  compactRef.current = compact;

  const measure = () => {
    const bar = ref.current;
    if (!bar) return;
    const size = (el: Element) => (vertical ? el.getBoundingClientRect().height : el.getBoundingClientRect().width);
    const available = vertical ? bar.clientHeight : bar.clientWidth;
    if (!available) return;
    // What the content needs: everything but the spacer, which takes the rest (or nothing when it overflows).
    const spacer = bar.querySelector<HTMLElement>(":scope > .sp");
    const content = (vertical ? bar.scrollHeight : bar.scrollWidth) - (spacer ? size(spacer) : 0);
    let needed = content;
    if (!compactRef.current) {
      let added = 0;
      for (const span of bar.querySelectorAll<HTMLElement>(":scope > .dt-btn > span, :scope > .dt-title > span")) {
        if (!span.getClientRects().length) continue;
        const gap = parseFloat(getComputedStyle(span.parentElement!).columnGap) || 0;
        added += size(span) + gap;
      }
      labels.current = added;
    } else needed = content + labels.current;
    const next = needed > available + SLACK;
    if (next !== compactRef.current) setCompact(next);
  };

  // No dependency list: a badge that grows is measured too.
  useLayoutEffect(measure);
  useLayoutEffect(() => {
    const bar = ref.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(bar);
    for (const child of bar.children) observer.observe(child);
    return () => observer.disconnect();
  }, [ref, vertical]); // `measure` reads the refs and `vertical`
  return compact;
}

/**
 * A toolbar with a roving tabindex: Tab enters it once, the arrow keys (along the bar), Home and End
 * move between its buttons. Docked left or right it is a vertical strip. The toggles show their
 * labels whenever all of them fit next to the dot and the dock switch; else icons and badges only.
 */
export function DevToolsBar({ label, title, status, toggles, dock, onDock, before = [], after = [] }: DevToolsBarProps) {
  const vertical = sideDock(dock);
  const ref = useRef<HTMLDivElement>(null);
  const compact = useCompact(ref, vertical);
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

  const button = (b: BarButton) => (
    <button key={b.label} type="button" className={`dt-ib ${b.className ?? ""}`} title={b.label} aria-label={b.label} onClick={b.onClick} {...roving()}>
      <Icon name={b.icon} size={13} />
    </button>
  );

  return (
    <div ref={ref} className={`dt-bar ${compact ? "dt-compact" : ""}`} role="toolbar" aria-label={label} aria-orientation={vertical ? "vertical" : "horizontal"} onKeyDown={onKeyDown}>
      <span className="dt-title">
        {/* TODO-FINDING tooltip-component - tooltips are `title` attributes as designed; a keyboard user never sees them */}
        <i className={`dot ${status.cls}`} role="img" aria-label={status.label} title={status.label} />
        <span>{title}</span>
      </span>
      {toggles.map((t) => (
        <button
          key={t.panel}
          type="button"
          className={`dt-btn ${t.pressed ? "on" : ""}`}
          aria-pressed={t.pressed}
          title={t.label}
          aria-label={t.name}
          data-dev-panel={t.panel}
          onClick={t.onToggle}
          {...roving()}
        >
          <Icon name={t.icon} size={13} />
          <span>{t.label}</span>
          {t.badge && <Badge {...t.badge} />}
        </button>
      ))}
      <span className="sp" />
      {before.map(button)}
      <span className="dt-dock" role="radiogroup" aria-label="Dock position">
        {DOCKS.map(({ dock: d, icon }) => (
          <button
            key={d}
            type="button"
            role="radio"
            className={`dt-ib ${d === dock ? "on" : ""}`}
            title={`Dock to the ${d}`}
            aria-label={`Dock to the ${d}`}
            aria-checked={d === dock}
            onClick={() => onDock(d)}
            {...roving()}
          >
            <Icon name={icon} size={13} />
          </button>
        ))}
      </span>
      {after.map(button)}
    </div>
  );
}

function Badge({ count, error = false }: { count?: number; error?: boolean }): ReactNode {
  return error ? (
    <em className="err">
      <Icon name="alert" size={9} />
      {count}
    </em>
  ) : (
    <em>{count}</em>
  );
}
