/**
 * How a provider starts the drag mode of a `DockArea` from its own elements (a window header, a
 * tab): after a few px of movement with the button down, so that a shorter press stays a click.
 */
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

import type { DockAreaHandle, DragItem } from "./DockArea";
import { clearSelection, preventSelection } from "./noSelection";

/** Movement (px) with the button down that starts a drag. */
const DRAG_THRESHOLD = 4;

/** The click that follows the release of a drag is not a click on the element it started on. */
function swallowNextClick() {
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
    // The press would start a text selection (the `mousedown` after this `pointerdown`), which the
    // movement of a drag stretches over the page: none until the button is released.
    const el = e.currentTarget;
    const allowSelection = preventSelection(el);
    // Window listeners and no pointer capture: a capture would retarget the click of a short press
    // to `el` (a button inside it would not get it).
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId || Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
      stopWatching();
      swallowNextClick();
      clearSelection(el);
      dock.current?.startDrag(makeItem(), ev);
    };
    const stopWatching = () => {
      window.removeEventListener("pointermove", move, true);
    };
    const release = () => {
      stopWatching();
      allowSelection();
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("blur", release);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    // the release may happen outside the window: it never comes
    window.addEventListener("blur", release);
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
