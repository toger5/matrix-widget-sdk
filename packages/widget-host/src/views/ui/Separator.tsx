/**
 * The window splitter of the dev tools (between their panels, towards the widget) and the size of a
 * parent it is measured against. Shared by the widget dev tools (`../widget/DevTools.tsx`) and the
 * room dev tools (`../devbackend/RoomDevTools.tsx`).
 */
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";

/** A panel keeps at least this share (in %) of the two panels a separator divides. */
export const MIN_SHARE = 15;

const RESIZE_TITLE = "Drag or use the arrow keys to resize · double click or Enter to reset";

export interface SeparatorProps {
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
export function Separator({ className, orientation, label, value, min, max, step, valueText, sign = 1, unitsPerPx, onChange, onReset, children }: SeparatorProps) {
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
 * The separator between panel `i` and `i + 1` of a row (or stack) of panels with `shares`: its value
 * is the percentage panel `i` has of both. `onShares` gets the new shares of all panels; `pairPx`
 * measures the two panels on screen (for the drag scale).
 */
export function PanelSplit({ i, shares, vertical, label, valueLabel, pairPx, onShares }: { i: number; shares: number[]; vertical: boolean; label: string; valueLabel: string; pairPx: () => number; onShares: (shares: number[]) => void }) {
  const percent = (shares[i] / (shares[i] + shares[i + 1])) * 100;
  const setPair = (p: number) => {
    const pair = shares[i] + shares[i + 1];
    const next = [...shares];
    next[i] = (pair * p) / 100;
    next[i + 1] = pair - next[i];
    onShares(next);
  };
  return (
    <Separator
      className="dt-split"
      orientation={vertical ? "horizontal" : "vertical"}
      label={label}
      value={percent}
      min={MIN_SHARE}
      max={100 - MIN_SHARE}
      step={5}
      valueText={`${valueLabel} ${Math.round(percent)} %`}
      unitsPerPx={() => 100 / Math.max(1, pairPx())}
      onChange={setPair}
      onReset={() => setPair(50)}
    />
  );
}

/** The length of the panels `i` and `i + 1` among the `.dt-panel` children of `container`, along the stacking axis. */
export function pairLength(container: HTMLElement | null, i: number, vertical: boolean): number {
  const els = container?.querySelectorAll<HTMLElement>(":scope > .dt-panel");
  const length = (el?: HTMLElement) => (el ? el.getBoundingClientRect()[vertical ? "height" : "width"] : 0);
  return length(els?.[i]) + length(els?.[i + 1]);
}

/**
 * The size of an element's parent along one axis, kept up to date. Measured before the first paint:
 * a ResizeObserver reports one frame later, and until then the separator's maximum is the current size.
 */
export function useParentLength(ref: RefObject<HTMLElement | null>, axis: "width" | "height"): number | undefined {
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
