/**
 * How a provider starts the drag mode of a `DockArea` from its own elements (a window header, a
 * tab): after a few px of movement with the button down, so that a shorter press stays a click.
 */
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

import type { DockAreaHandle, DragItem } from "./DockArea";

/** Movement (px) with the button down that starts a drag. */
export const DRAG_THRESHOLD = 4;

/** The click that follows the release of a drag is not a click on the element it started on. */
export function swallowNextClick() {
  const swallow = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener("click", swallow, true);
  window.addEventListener("pointerup", () => setTimeout(() => window.removeEventListener("click", swallow, true)), { once: true });
}

/**
 * A `pointerdown` handler that starts the dock's drag mode with `makeItem()` after
 * `DRAG_THRESHOLD` px. A press on an element matching `ignore` (inside the element) starts nothing.
 */
export function dragStarter(dock: RefObject<DockAreaHandle | null>, makeItem: () => DragItem, ignore?: string) {
  return (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    if (ignore) {
      const hit = (e.target as Element).closest(ignore);
      if (hit && e.currentTarget.contains(hit)) return;
    }
    const start = { x: e.clientX, y: e.clientY };
    const { pointerId } = e;
    // Window listeners and no pointer capture: a capture would retarget the click of a short press
    // to `el` (a button inside it would not get it).
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId || Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
      stop();
      swallowNextClick();
      dock.current?.startDrag(makeItem(), ev);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", stop, true);
      window.removeEventListener("pointercancel", stop, true);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", stop, true);
    window.addEventListener("pointercancel", stop, true);
  };
}

/** The drag ghost: a chip with a label (`.dock-chip`; `hue` sets `--hue` on it, for a provider's own CSS). */
export function dragChip(label: string, hue?: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "dock-chip";
  if (hue !== undefined) el.style.setProperty("--hue", String(hue));
  el.textContent = label;
  return el;
}
