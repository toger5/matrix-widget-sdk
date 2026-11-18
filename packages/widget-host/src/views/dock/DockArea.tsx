import { Fragment, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from "react";

import {
  dockColumns,
  flexGrows,
  insertAt,
  moveItem,
  removeItem,
  resetSplit,
  resizeSplit,
  shareOf,
  splitShares,
  type DockItem,
  type DockItemId,
  type DockLayout,
  type DockSplit,
  type DropTarget,
} from "./dockLayout";
import { allowedTargets, GAP, isSaturated, measureTargets, nearestTargets, targetKey, type Rect } from "./dockTargets";
import { Splitter } from "./Splitter";

/** Something dragged onto a `DockArea`: a tab, or a whole window (`sourceId`). */
export interface DragItem {
  /** Rendered under the pointer while dragging (the "ghost"). */
  element: HTMLElement;
  /** Items of the layout with this group accept the drag (`into` targets), e.g. the room of a tab. */
  group?: string;
  /** Set when an item of this dock is dragged (a whole window): it moves to the target. Unset (a tab): the target gets a new item. */
  sourceId?: DockItemId;
  /** Released without a target, Escape, or the window lost the focus: nothing changes, the provider keeps its item. */
  cancel(): void;
  /**
   * Released on a target: the drag is consumed. Returns the element now shown for `itemId`: for
   * `into` the target item (often its element as it is), else the moved item (`sourceId`) or a new
   * item. The dock then calls `onLayoutChange` with it.
   */
  drop(target: DropTarget, itemId: DockItemId): HTMLElement;
}

export interface DockAreaHandle {
  /** Enter drag mode. Call it from the provider's own pointer handling (e.g. after a few px of movement); the dock follows the pointer until it is released. */
  startDrag(item: DragItem, at: { clientX: number; clientY: number }): void;
  /** Leave drag mode as if Escape was pressed. */
  cancelDrag(): void;
}

export interface DockAreaProps {
  layout: DockLayout;
  /**
   * The element shown for each item; the dock moves it into its cell. Moving an element in the DOM
   * keeps React portals inside it, but an iframe inside it would reload: in the widget host, widgets
   * are shown through `<slot>`s (`WidgetSlot`), which can move.
   */
  elements: ReadonlyMap<DockItemId, HTMLElement>;
  /** A drop or a resize. `placed` is the item a drop put an element into (new, moved, or the `into` target). */
  onLayoutChange(next: DockLayout, placed?: { id: DockItemId; element: HTMLElement }): void;
  /** Ids of new items (a tab dropped outside of an `into` target). */
  newId?: () => DockItemId;
  /** px; default 280 (the minimum width of a room panel) */
  minItemWidth?: number;
  /** px; default 160 */
  minItemHeight?: number;
  /**
   * Whether no place is left for a new window (`isSaturated`): called on mount and whenever it
   * changes, so the caller can ask to close a window before another one is opened or dragged out.
   */
  onSaturatedChange?(saturated: boolean): void;
  className?: string;
  ref?: Ref<DockAreaHandle>;
}

let counter = 0;
const defaultNewId = () => `dock-${Date.now().toString(36)}-${(counter++).toString(36)}`;

interface DragState {
  item: DragItem;
  /** pointer in viewport coordinates (the ghost follows it without a render) */
  client: { x: number; y: number };
  targets: DropTarget[];
  /** keys of the shown targets: their gaps are open */
  shown: ReadonlySet<string>;
  /** key of the target a release drops on */
  active?: string;
}

type Drop = "shown" | "active" | undefined;

/**
 * A layout of one or two rows of one to three items, with optional full-height items on the left
 * and the right (`DockLayout`), with resize handles at every split and a drag mode.
 *
 * Every gap is an element: the 8px splitters between neighbours, and 0px gaps at the edges of the
 * rows, the center and the dock. While dragging, the gaps of the targets near the pointer open to
 * 48px (dashed gray box), the nearest one is active (blue); `into` targets are boxes inside their
 * item. The targets are measured on every frame, so opening gaps move them as they are drawn.
 * Controlled: the layout and the elements come from the caller. Playground: `npm run dock`.
 */
export function DockArea({ layout, elements, onLayoutChange, newId = defaultNewId, minItemWidth = 280, minItemHeight = 160, onSaturatedChange, className = "", ref }: DockAreaProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | undefined>(undefined);
  const dragRef = useRef<DragState | undefined>(undefined);
  const frame = useRef(0);
  // The window listeners and the frame loop of a drag outlive renders: they read the latest props through this.
  const latest = useRef({ layout, onLayoutChange, newId });
  latest.current = { layout, onLayoutChange, newId };

  const placeGhost = () => {
    const state = dragRef.current;
    if (state && ghostRef.current) ghostRef.current.style.transform = `translate(${state.client.x + 12}px, ${state.client.y + 12}px)`;
  };

  /** One frame of a drag: measure the targets' elements, pick the shown and the active ones. */
  const tick = useCallback(() => {
    const state = dragRef.current;
    const el = areaRef.current;
    if (!state || !el) return;
    placeGhost();
    const area = el.getBoundingClientRect();
    const rects: Record<string, Rect> = {};
    for (const node of el.querySelectorAll<HTMLElement>("[data-dock-target]")) {
      const r = node.getBoundingClientRect();
      rects[node.dataset.dockTarget!] = { x: r.left - area.left, y: r.top - area.top, width: r.width, height: r.height };
    }
    const measured = measureTargets(state.targets, rects);
    const { shown, active } = nearestTargets(measured, { x: state.client.x - area.left, y: state.client.y - area.top }, state.shown);
    const keys = shown.map((m) => m.key);
    if (active?.key !== state.active || keys.length !== state.shown.size || keys.some((k) => !state.shown.has(k))) {
      const next = { ...state, shown: new Set(keys), active: active?.key };
      dragRef.current = next;
      setDrag(next);
    }
    frame.current = requestAnimationFrame(tick);
  }, []);

  const listeners = useRef<{ add(): void; remove(): void } | undefined>(undefined);

  const finish = useCallback((dropIt: boolean) => {
    const state = dragRef.current;
    if (!state) return;
    listeners.current?.remove();
    cancelAnimationFrame(frame.current);
    dragRef.current = undefined;
    setDrag(undefined);
    const { item } = state;
    // what was shown in blue is where it lands
    const target = state.active === undefined ? undefined : state.targets.find((t) => targetKey(t) === state.active);
    if (!dropIt || !target) {
      item.cancel();
      return;
    }
    const { layout: current, onLayoutChange: change, newId: makeId } = latest.current;
    const { sourceId, group } = item;
    const itemId = target.kind === "into" ? target.itemId : (sourceId ?? makeId());
    const element = item.drop(target, itemId);
    let next: DockLayout;
    if (target.kind === "into") next = sourceId ? removeItem(current, sourceId) : current;
    else if (sourceId) next = moveItem(current, sourceId, target);
    else next = insertAt(current, target, { id: itemId, ...(group === undefined ? {} : { group }) });
    change(next, { id: itemId, element });
  }, []);

  if (!listeners.current) {
    const onMove = (e: PointerEvent) => {
      if (dragRef.current) dragRef.current = { ...dragRef.current, client: { x: e.clientX, y: e.clientY } };
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    };
    listeners.current = {
      add() {
        window.addEventListener("pointermove", onMove, true);
        window.addEventListener("pointerup", onUp, true);
        window.addEventListener("pointercancel", onCancel, true);
        window.addEventListener("keydown", onKey, true);
        window.addEventListener("blur", onCancel);
      },
      remove() {
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        window.removeEventListener("pointercancel", onCancel, true);
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("blur", onCancel);
      },
    };
  }

  // Unmounted while dragging: the drag is cancelled.
  useEffect(() => () => finish(false), [finish]);

  const reportedSaturated = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (!onSaturatedChange) return;
    const saturated = isSaturated(layout);
    if (saturated === reportedSaturated.current) return;
    reportedSaturated.current = saturated;
    onSaturatedChange(saturated);
  }, [layout, onSaturatedChange]);
  // The ghost is placed by the frame loop; after a render (it may be new) place it at once.
  useLayoutEffect(placeGhost);

  useImperativeHandle(
    ref,
    () => ({
      startDrag(item, at) {
        finish(false);
        if (!areaRef.current) return item.cancel();
        const state: DragState = { item, client: { x: at.clientX, y: at.clientY }, targets: allowedTargets(latest.current.layout, item), shown: new Set() };
        dragRef.current = state;
        setDrag(state);
        listeners.current?.add();
        frame.current = requestAnimationFrame(tick);
      },
      cancelDrag: () => finish(false),
    }),
    [finish, tick],
  );

  const dropOf = (key: string): Drop => (drag?.active === key ? "active" : drag?.shown.has(key) ? "shown" : undefined);
  const gap = (key: string, axis: "x" | "y", reactKey: string = key) => <div key={reactKey} className={`dock-gap ${axis}`} data-dock-target={key} data-dock-drop={dropOf(key)} />;
  const split = (s: DockSplit, axis: "x" | "y", minBefore: number, minAfter: number, label: string, target?: string) => {
    const shares = splitShares(layout, s);
    const value = shares ? (100 * shares[0]) / (shares[0] + shares[1]) : 50;
    return (
      <Splitter
        axis={axis}
        label={label}
        value={value}
        minBefore={minBefore}
        minAfter={minAfter}
        target={target}
        drop={target ? dropOf(target) : undefined}
        onResize={(fraction) => {
          const next = resizeSplit(layout, s, fraction);
          if (next !== layout) onLayoutChange(next);
        }}
        onReset={() => onLayoutChange(resetSplit(layout, s))}
      />
    );
  };
  const cell = (item: DockItem, grow: number) => (
    <Cell key={item.id} item={item} grow={grow} element={elements.get(item.id)} source={drag?.item.sourceId === item.id} drop={dropOf(`into:${item.id}`)} />
  );
  const { center } = layout;
  const { rows } = center;
  const leftItems = layout.left ?? [];
  const rightItems = layout.right ?? [];
  const l = leftItems.length;
  // Grow factors from the shares, adding up to 1 per set of siblings (`flexGrows`): the columns, the rows, the items of a row.
  const columnGrows = flexGrows(dockColumns(layout).map(shareOf));
  const rowGrows = flexGrows(rows.map(shareOf));
  const widest = Math.max(1, ...rows.map((r) => r.items.length));
  const minWidth = (column: number) => (column === l ? widest * minItemWidth + (widest - 1) * GAP : minItemWidth);
  /** The splitter between the columns `index` and `index + 1`; it is the gap of a side target too. */
  const columnSplit = (index: number, target: string) => split({ kind: "columns", index }, "x", minWidth(index), minWidth(index + 1), "Resize columns", target);
  const empty = rows.length === 0;

  return (
    <div className={`dock ${className}`} ref={areaRef} data-testid="dock" data-dragging={drag ? "" : undefined}>
      {gap("side:left:0", "x", "left-edge")}
      {leftItems.map((item, i) => (
        <Fragment key={item.id}>
          {i > 0 && columnSplit(i - 1, `side:left:${i}`)}
          {cell(item, columnGrows[i])}
        </Fragment>
      ))}
      {l > 0 && columnSplit(l - 1, `side:left:${l}`)}
      <div className="dock-center" style={{ flexGrow: columnGrows[l] }} data-dock-target={empty ? "newRow:0" : undefined} data-dock-drop={empty ? dropOf("newRow:0") : undefined}>
        {!empty && gap("newRow:0", "y", "top")}
        {rows.map((row, r) => {
          const itemGrows = flexGrows(row.items.map(shareOf));
          return (
            <Fragment key={r}>
              {r > 0 && split({ kind: "rows", index: r - 1 }, "y", minItemHeight, minItemHeight, "Resize rows", `newRow:${r}`)}
              <div className="dock-row" style={{ flexGrow: rowGrows[r] }} data-dock-row={r}>
                {gap(`between:${r}:0`, "x", "start")}
                {row.items.map((item, i) => (
                  <Fragment key={item.id}>
                    {i > 0 && split({ kind: "items", row: r, index: i - 1 }, "x", minItemWidth, minItemWidth, "Resize items", `between:${r}:${i}`)}
                    {cell(item, itemGrows[i])}
                  </Fragment>
                ))}
                {gap(`between:${r}:${row.items.length}`, "x", "end")}
              </div>
            </Fragment>
          );
        })}
        {!empty && gap(`newRow:${rows.length}`, "y", "bottom")}
      </div>
      {rightItems.map((item, i) => (
        <Fragment key={item.id}>
          {columnSplit(l + i, `side:right:${i}`)}
          {cell(item, columnGrows[l + 1 + i])}
        </Fragment>
      ))}
      {gap(`side:right:${rightItems.length}`, "x", "right-edge")}
      {drag && (
        <div className="dock-overlay" data-testid="dock-overlay">
          <div className="dock-ghost" ref={ghostRef}>
            <ElementHost className="dock-ghost-in" element={drag.item.element} />
          </div>
        </div>
      )}
    </div>
  );
}

/** A cell of the dock, which shows the element of its item; while it is an `into` target, a box inside it. */
function Cell({ item, grow, element, source, drop }: { item: DockItem; grow: number; element?: HTMLElement; source: boolean; drop: Drop }) {
  return (
    <ElementHost
      className="dock-item"
      element={element}
      style={{ flexGrow: grow }}
      data={{
        "data-dock-item": item.id,
        "data-dock-target": `into:${item.id}`,
        "data-dock-drop": drop,
        "data-dock-source": source ? "" : undefined,
        "data-testid": "dock-item",
      }}
    />
  );
}

/** A div whose only child is `element` (moved in, not copied). */
function ElementHost({ element, className, style, data }: { element?: HTMLElement; className: string; style?: CSSProperties; data?: Record<string, string | undefined> }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    if (!element) host.replaceChildren();
    else if (host.childNodes.length !== 1 || host.firstChild !== element) host.replaceChildren(element);
  }, [element]);
  return <div ref={ref} className={className} style={style} {...data} />;
}
