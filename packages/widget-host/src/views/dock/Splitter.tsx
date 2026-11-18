import { useRef, type KeyboardEvent, type PointerEvent } from "react";

const KEY_STEP = 24;

export interface SplitterProps {
  /** "x": between neighbours side by side (a vertical bar, resizes widths); "y": between neighbours stacked (resizes heights). */
  axis: "x" | "y";
  /** The first (left or top) neighbour's part of the two, 0..1. */
  onResize(fraction: number): void;
  /** double click / Enter */
  onReset(): void;
  /** Minimum sizes of the neighbours in px (both get half the space if there is not enough for them). */
  minBefore: number;
  minAfter: number;
  /** aria-valuenow, 0..100 */
  value: number;
  label: string;
  /** The drop target of this gap (`targetKey`), if any: the dock measures it while dragging. */
  target?: string;
  /** While dragging: the target is shown (the gap opens to 48px) or active. */
  drop?: "shown" | "active";
}

/**
 * The drag handle between two neighbours of a `DockArea` (its previous and next element sibling).
 * It is the 8px gap between them; while dragging, it is also the drop gap of the target between
 * them (`target`, `drop`). Drag, the arrow keys, Home and End resize; double
 * click and Enter reset. Generalized from `PanelSeparator` (`views/rooms/RoomsArea.tsx`).
 */
export function Splitter({ axis, onResize, onReset, minBefore, minAfter, value, label, target, drop }: SplitterProps) {
  const drag = useRef<{ start: number; before: number; total: number } | undefined>(undefined);
  const size = (el: Element | null | undefined) => {
    const r = el?.getBoundingClientRect();
    return r ? (axis === "x" ? r.width : r.height) : 0;
  };
  /** The current sizes of the two neighbours, in px. */
  const sizes = (splitter: Element) => {
    const before = size(splitter.previousElementSibling);
    return { before, total: before + size(splitter.nextElementSibling) };
  };
  const resizeTo = (before: number, total: number) => {
    if (total <= 0) return;
    const enough = minBefore + minAfter <= total;
    const px = enough ? Math.min(Math.max(before, minBefore), total - minAfter) : total / 2;
    onResize(px / total);
  };
  const pos = (e: PointerEvent) => (axis === "x" ? e.clientX : e.clientY);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: pos(e), ...sizes(e.currentTarget) };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) resizeTo(drag.current.before + pos(e) - drag.current.start, drag.current.total);
  };
  const endDrag = () => {
    drag.current = undefined;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const { before, total } = sizes(e.currentTarget);
    const [less, more] = axis === "x" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    const to = { [less]: before - KEY_STEP, [more]: before + KEY_STEP, Home: 0, End: total }[e.key];
    if (to !== undefined) {
      e.preventDefault();
      resizeTo(to, total);
    } else if (e.key === "Enter") {
      e.preventDefault();
      onReset();
    }
  };

  return (
    <div
      className={`dock-split ${axis}`}
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      title="Drag or use the arrow keys to resize · double click or Enter to reset"
      data-testid="dock-splitter"
      data-dock-target={target}
      data-dock-drop={drop}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    >
      <i />
    </div>
  );
}
