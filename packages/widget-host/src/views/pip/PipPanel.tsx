import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import type { PipViewModel, WidgetInstanceId } from "../../appViewModel";
import type { RenderWidget } from "../app/AppShell";
import { useDispatch } from "../env";
import { Avatar, Icon, type IconName } from "../ui/atoms";

/** One always-on-screen widget whose tab is not shown. */
export interface PipItem {
  widgetId: WidgetInstanceId;
  widgetName: string;
  roomName: string;
  /** Its WidgetDevToolBar is open: the box offers "close dev tools". */
  devToolsOpen: boolean;
}

export interface PipPanelProps {
  pip: PipViewModel;
  /** The widgets that get a box (at most `PIP_VISIBLE_BOXES`). */
  items: PipItem[];
  /** The widgets that do not fit: listed in the overflow menu. */
  more: PipItem[];
  renderWidget: RenderWidget;
  /** Stories only: show the surrounding box without a pointer over the panel. */
  forceHover?: boolean;
  /** Stories only: start with the overflow menu open. */
  defaultMenuOpen?: boolean;
}

type Position = PipViewModel["position"];
type BoxSize = PipViewModel["boxSize"];
interface Geometry {
  position: Position;
  boxSize: BoxSize;
}

// The geometry of the design rules (`src/styles/pip.css`: `.pip.hover`, `.pip-grip`, `.pip-label`, `.pip-list`, `.pip-more`).
/** Gap between two boxes. */
const GAP = 6;
/** What the surround adds left, right and below the boxes: 10px padding + 1px border. */
const EDGE = 11;
/** What the surround adds above the boxes: border, padding, the grip row and its margin. */
const HEAD = 1 + 8 + 24 + 4;
/** A label row and the gap to its box. */
const LABEL = 28 + 4;
/** The "+N" tile (min-width / min-height) next to or below the boxes. */
const MORE_TILE = { horizontal: 40, vertical: 32 };
const MIN_BOX: BoxSize = { width: 160, height: 100 };
const KEY_STEP = 16;
const HOVER_OUT_MS = 150;

const clamp = (value: number, min: number, max: number) => Math.round(Math.max(min, Math.min(value, Math.max(min, max))));
const samePosition = (a: Position, b: Position) => a.x === b.x && a.y === b.y;
const sameSize = (a: BoxSize, b: BoxSize) => a.width === b.width && a.height === b.height;

/**
 * The PictureInPicturePanel. stories `app-pippanel--*`, `app-appshell--pip-enlarged-dev-tools`. Renders nothing without items.
 *
 * `pip.position` is the distance of the boxes from the bottom-right corner of the `.app` element
 * (the design rules position the panel with `right` / `bottom`). The surround grows outward around the
 * boxes: the panel is anchored at the bottom right, so the grip row and (stacked horizontally) the
 * label rows grow upwards, and the padding of the surround is compensated in `right` / `bottom`.
 */
export function PipPanel({ pip, items, more, renderWidget, forceHover = false, defaultMenuOpen = false }: PipPanelProps) {
  const dispatch = useDispatch();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);

  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [menuOpenState, setMenuOpen] = useState(defaultMenuOpen);
  const [dragging, setDragging] = useState<"move" | "resize" | undefined>();
  /** Size of the `.app` element (the offset parent), for clamping. */
  const [bounds, setBounds] = useState<{ width: number; height: number } | undefined>();
  /** What a drag or a key press asked for, shown until the view model answers with a new value. */
  const [live, setLive] = useState<Geometry | undefined>();

  const hoverOut = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drag = useRef<({ kind: "move" | "resize"; pointerId: number; startX: number; startY: number; frame?: number } & Geometry) | undefined>(undefined);
  /** The last values sent to the controller, so one frame does not send the same intent twice. */
  const sent = useRef<Geometry>({ position: pip.position, boxSize: pip.boxSize });

  const horizontal = pip.stacking === "horizontal";
  const count = items.length;
  const hasItems = count > 0;
  const menuOpen = menuOpenState && more.length > 0;
  const surround = forceHover || hovered || focusWithin || menuOpen || !!dragging;

  // --- geometry ---------------------------------------------------------------------------

  /** How many boxes share the width / the height of the container. */
  const across = horizontal ? count : 1;
  const down = horizontal ? 1 : count;
  /** What is next to the boxes in the list, along the stacking direction: gaps, the "+N" tile and (vertical) the label rows. */
  const moreTile = more.length ? GAP + MORE_TILE[pip.stacking] : 0;
  const extraWidth = horizontal ? (count - 1) * GAP + moreTile : 0;
  const extraHeight = horizontal ? 0 : count * LABEL + (count - 1) * GAP + moreTile;
  /** What the surround adds above the list. Stacked vertically the label rows are part of the list. */
  const top = HEAD + (horizontal ? LABEL : 0);

  /** The panel, with its surround, stays inside the window. */
  const clampPosition = useCallback(
    (position: Position, box: BoxSize): Position => {
      if (!bounds) return position;
      const width = across * box.width + extraWidth;
      const height = down * box.height + extraHeight;
      return { x: clamp(position.x, EDGE, bounds.width - width - EDGE), y: clamp(position.y, EDGE, bounds.height - height - top) };
    },
    [bounds, across, down, extraWidth, extraHeight, top],
  );

  /** "Up to almost the size of the screen": the whole container, with its surround, still fits in the window. */
  const clampBox = useCallback(
    (box: BoxSize): BoxSize => {
      const maxWidth = bounds ? Math.floor((bounds.width - 2 * EDGE - extraWidth) / across) : Infinity;
      const maxHeight = bounds ? Math.floor((bounds.height - EDGE - top - extraHeight) / down) : Infinity;
      return { width: clamp(box.width, MIN_BOX.width, maxWidth), height: clamp(box.height, MIN_BOX.height, maxHeight) };
    },
    [bounds, across, down, extraWidth, extraHeight, top],
  );

  const boxSize = live?.boxSize ?? pip.boxSize;
  const position = clampPosition(live?.position ?? pip.position, boxSize);

  useLayoutEffect(() => {
    const parent = rootRef.current?.offsetParent;
    if (!parent) return;
    const measure = () => setBounds((old) => (old?.width === parent.clientWidth && old.height === parent.clientHeight ? old : { width: parent.clientWidth, height: parent.clientHeight }));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [hasItems]);

  // The view model answered (or changed for another reason): it is the truth again.
  useEffect(() => {
    sent.current = { position: pip.position, boxSize: pip.boxSize };
    if (!drag.current) setLive(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pip.position.x, pip.position.y, pip.boxSize.width, pip.boxSize.height]);

  useEffect(
    () => () => {
      clearTimeout(hoverOut.current);
      if (drag.current?.frame !== undefined) cancelAnimationFrame(drag.current.frame);
    },
    [],
  );

  // --- move and resize --------------------------------------------------------------------

  const wanted = useRef<Geometry>({ position, boxSize });

  const flush = useCallback(() => {
    const { position: p, boxSize: b } = wanted.current;
    if (!sameSize(b, sent.current.boxSize)) dispatch({ type: "pip/resize", boxSize: b });
    if (!samePosition(p, sent.current.position)) dispatch({ type: "pip/move", position: p });
    sent.current = { position: p, boxSize: b };
  }, [dispatch]);

  const show = (next: Geometry) => {
    wanted.current = next;
    setLive(next);
  };

  /**
   * A new box size that keeps the top-left corner of the container where it is, so the resize
   * corner (bottom right) follows the pointer: the panel is anchored at the bottom right, so
   * growing also moves it, until it reaches the window edge.
   */
  const resized = (from: Geometry, to: BoxSize): Geometry => {
    // TODO-FINDING pip-resize-moves - `pip.position` is measured from the bottom-right corner, and the design draws the resize corner there too. To make the corner follow the pointer a resize sends `pip/resize` AND `pip/move`. Alternatives: a resize corner at the top left, or a top-left `position`.
    const box = clampBox(to);
    return { boxSize: box, position: clampPosition({ x: from.position.x - (box.width - from.boxSize.width) * across, y: from.position.y - (box.height - from.boxSize.height) * down }, box) };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as Element;
    // The surround is the drag area: not the boxes (the widgets), not the buttons, not the menu.
    if (target.closest("button, .pip-box, .pip-menu")) return;
    const kind = target.closest(".pip-resize") ? "resize" : "move";
    drag.current = { kind, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, position, boxSize };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(kind);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    show(d.kind === "move" ? { boxSize: d.boxSize, position: clampPosition({ x: d.position.x - dx, y: d.position.y - dy }, d.boxSize) } : resized(d, { width: d.boxSize.width + dx / across, height: d.boxSize.height + dy / down }));
    // At most one intent per animation frame: the panel follows the pointer without flooding the controller.
    d.frame ??= requestAnimationFrame(() => {
      d.frame = undefined;
      flush();
    });
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (d.frame !== undefined) cancelAnimationFrame(d.frame);
    drag.current = undefined;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(undefined);
    flush();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && menuOpen) {
      e.stopPropagation();
      setMenuOpen(false);
      moreRef.current?.focus();
      return;
    }
    // A key press inside the panel shows the surround, also when the focus came from a click or a script (no `:focus-visible`).
    setFocusWithin(true);
    // Arrow keys move / resize only while the container itself has the focus, not one of its buttons or a widget.
    if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
    const step = ({ ArrowLeft: [-KEY_STEP, 0], ArrowRight: [KEY_STEP, 0], ArrowUp: [0, -KEY_STEP], ArrowDown: [0, KEY_STEP] } as Record<string, [number, number] | undefined>)[e.key];
    if (!step) return;
    e.preventDefault();
    const [dx, dy] = step;
    const from = { position, boxSize };
    show(e.shiftKey ? resized(from, { width: boxSize.width + dx, height: boxSize.height + dy }) : { boxSize, position: clampPosition({ x: position.x - dx, y: position.y - dy }, boxSize) });
    flush();
  };

  // --- surround: hover (with a delay on the way out) and keyboard focus ----------------------

  // Native listeners: the widget iframes are slotted into the boxes from the light DOM and are not
  // part of this React tree, so React's `onPointerEnter` never fires while the pointer is over a
  // widget (with one widget the idle panel is nothing but its iframe). `pointerover` / `pointerout`
  // bubble through the slot; going from one part of the panel to another is an "out" followed by an
  // "over", which cancels the delay.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const over = () => {
      clearTimeout(hoverOut.current);
      setHovered(true);
    };
    const out = () => {
      clearTimeout(hoverOut.current);
      hoverOut.current = setTimeout(() => setHovered(false), HOVER_OUT_MS);
    };
    root.addEventListener("pointerover", over);
    root.addEventListener("pointerout", out);
    return () => {
      root.removeEventListener("pointerover", over);
      root.removeEventListener("pointerout", out);
    };
  }, [hasItems]);

  // --- overflow menu ------------------------------------------------------------------------

  useEffect(() => {
    if (!menuOpen) return;
    // The app lives in a shadow root: `composedPath` sees through it, `event.target` does not.
    const onDown = (e: Event) => {
      const path = e.composedPath();
      if ((menuRef.current && path.includes(menuRef.current)) || (moreRef.current && path.includes(moreRef.current))) return;
      setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [menuOpen]);

  const openedByUser = useRef(false);
  useEffect(() => {
    if (menuOpen && openedByUser.current) menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    openedByUser.current = false;
  }, [menuOpen]);

  /** Up / down: the same button of the next widget. Left / right: the other button. */
  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const entries = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]"));
    const at = entries.indexOf(e.target as HTMLElement);
    const to = ({ ArrowDown: at + 2, ArrowUp: at - 2, ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: entries.length - 1 } as Record<string, number | undefined>)[e.key];
    if (to === undefined || at < 0) return;
    e.preventDefault();
    entries[Math.max(0, Math.min(to, entries.length - 1))]?.focus();
  };

  if (!hasItems) return null;

  // The controller asks for confirmation (the widget still wants to stay on screen): no confirm here.
  const stop = (item: PipItem, role?: "menuitem") => (
    <LabelButton icon="x" label={`Stop ${item.widgetName}`} title={`Close ${item.widgetName}: stops the widget`} role={role} testId="pip-stop" onClick={() => dispatch({ type: "widget/close", widgetId: item.widgetId })} />
  );

  return (
    // The design used an <aside>; `role="group"` is not allowed on it, so this is a <div>.
    <div
      ref={rootRef}
      className={`pip ${horizontal ? "h" : "v"} ${surround ? "hover" : ""} ${dragging ? `dragging ${dragging}` : ""}`}
      style={{ right: position.x - (surround ? EDGE : 0), bottom: position.y - (surround ? EDGE : 0) }}
      role="group"
      aria-label="Always-on-screen widgets"
      tabIndex={0}
      data-testid="pip"
      data-stacking={pip.stacking}
      data-surround={surround}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onFocus={(e) => setFocusWithin(e.target.matches(":focus-visible"))}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setFocusWithin(false)}
      onKeyDown={onKeyDown}
    >
      {surround && (
        <div className="pip-grip" title="Drag to move">
          <Icon name="grip" size={14} />
          <span>Always on screen</span>
          <span className="sp" />
          <LabelButton
            icon={horizontal ? "rows" : "columns"}
            label={horizontal ? "Stack vertically" : "Stack horizontally"}
            testId="pip-stacking"
            onClick={() => dispatch({ type: "pip/setStacking", stacking: horizontal ? "vertical" : "horizontal" })}
          />
        </div>
      )}
      {menuOpen && (
        // TODO-FINDING pip-menu-placement - the design always opens the menu above the container, right-aligned. Near the top of the window (likely when stacked vertically) it is cut off: it should flip below or to the side.
        <div ref={menuRef} className="dropdown pip-menu" role="menu" aria-label="More always-on-screen widgets" data-testid="pip-menu" onKeyDown={onMenuKeyDown}>
          {more.map((item) => (
            // TODO-FINDING pip-menu-roles - the design made the row the `menuitem` and puts two buttons into it, which is not valid ARIA. Here the row is presentational and the two buttons are the menu items.
            // TODO-FINDING pip-overflow-no-swap - a hidden widget can only be jumped to or stopped; there is no way to swap it into one of the boxes.
            <div key={item.widgetId} className="dd-row" role="none" data-widget-id={item.widgetId}>
              <Avatar name={item.widgetName} id={item.widgetId} size={22} square />
              <span>
                <b>{item.widgetName}</b>
                <small>{item.roomName}</small>
              </span>
              <LabelButton
                icon="goToTab"
                label={`Go to ${item.widgetName}`}
                title="Go to tab: opens the widget's tab"
                role="menuitem"
                testId="pip-go-to-tab"
                onClick={() => {
                  setMenuOpen(false);
                  dispatch({ type: "widget/jumpToTab", widgetId: item.widgetId });
                }}
              />
              {stop(item, "menuitem")}
            </div>
          ))}
        </div>
      )}
      <div className="pip-list">
        {items.map((item) => (
          // The cell and the label are always rendered (CSS hides the label while idle), so a box is never remounted when the surround appears.
          // TODO-FINDING pip-vertical-label-space - stacked vertically the design puts the label rows between the boxes, so showing them would push the boxes apart. The space is reserved while idle instead (32px between the boxes, not the 6px of story `app-pippanel--vertical-idle`). Alternative: labels left of the boxes ("next to each box", docs/product.md), which keeps the idle gaps but differs from story `app-pippanel--vertical`.
          <div key={item.widgetId} className="pip-cell" style={{ width: boxSize.width }}>
            <div className="pip-label">
              <span className="pip-names">
                <small>{item.roomName}</small>
                <b>{item.widgetName}</b>
              </span>
              <LabelButton
                icon="goToTab"
                label={`Go to ${item.widgetName}`}
                title="Go to tab: opens the widget's tab, which takes it out of this panel"
                testId="pip-go-to-tab"
                onClick={() => dispatch({ type: "widget/jumpToTab", widgetId: item.widgetId })}
              />
              {item.devToolsOpen && (
                // TODO-FINDING pip-dev-tools-close-only - a box can close its dev tools but not open them. With several boxes the name "Close dev tools" is not unique: scope by the cell.
                <LabelButton icon="dots" label="Close dev tools" title="Close the widget dev tools" className="on" testId="pip-close-dev-tools" onClick={() => dispatch({ type: "devTools/toggle", widgetId: item.widgetId })} />
              )}
              {stop(item)}
            </div>
            <div className="pip-box" style={{ width: boxSize.width, height: boxSize.height }} data-testid="pip-box" data-widget-id={item.widgetId}>
              {renderWidget(item.widgetId, { compact: true })}
            </div>
          </div>
        ))}
        {more.length > 0 && (
          <button
            ref={moreRef}
            type="button"
            className={`pip-more ${menuOpen ? "on" : ""}`}
            style={horizontal ? { height: boxSize.height } : { width: boxSize.width }}
            title={`${more.length} more always-on-screen widgets`}
            aria-label={`${more.length} more always-on-screen widgets`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            data-testid="pip-more"
            onClick={() => {
              openedByUser.current = !menuOpen;
              setMenuOpen(!menuOpen);
            }}
          >
            +{more.length}
          </button>
        )}
      </div>
      {/* Resizing by keyboard is Shift+arrow on the container, so the corner is not a control of its own. */}
      {surround && <i className="pip-resize" title="Drag to resize" aria-hidden="true" data-testid="pip-resize" />}
    </div>
  );
}

/** An extra small `IconButton`, with an accessible name that may differ from the (longer) tooltip. */
function LabelButton({ icon, label, title = label, className = "", role, testId, onClick }: { icon: IconName; label: string; title?: string; className?: string; role?: "menuitem"; testId: string; onClick: () => void }) {
  return (
    <button type="button" className={`ibtn xs ${className}`} title={title} aria-label={label} role={role} data-testid={testId} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}
