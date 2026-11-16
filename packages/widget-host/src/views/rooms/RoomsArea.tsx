import { Fragment, useRef, type KeyboardEvent, type PointerEvent } from "react";

import { activeAccount, activeWorkspace, type MainViewModel, type RoomPanelViewModel, type SettingsViewModel } from "../../appViewModel";
import type { RenderWidget } from "../app/AppShell";
import { useDispatch, useViewEnv } from "../env";
import { Button, Icon } from "../ui/atoms";
import { RoomPanel } from "./RoomPanel";

export interface RoomsAreaProps {
  main: MainViewModel;
  settings: SettingsViewModel;
  /** `fullscreenWidget(vm)` is set: the single panel has no rounded container, its header hides tab and + until hovered or focused. */
  fullscreen: boolean;
  renderWidget: RenderWidget;
}

/** "Every resizable panel has a minimum size." */
export const MIN_PANEL_WIDTH = 280;
const KEY_STEP = 24;

/** stories `app-appshell--one-panel`, `app-appshell--several-panels`, `app-appshell--different-rooms`, `app-appshell--same-room-twice`; its parts: `rooms-*--*`. The `<main class="roomsarea">` with its room panels. */
export function RoomsArea({ main, settings, fullscreen, renderWidget }: RoomsAreaProps) {
  const dispatch = useDispatch();
  const { narrow } = useViewEnv();
  const roomsArea = activeWorkspace(main)?.roomsArea;
  const panels = roomsArea?.panels ?? [];

  if (panels.length === 0) {
    const devBackend = activeAccount(main)?.kind === "devBackend";
    return (
      <main className="roomsarea" data-testid="roomsarea">
        <div className="area-empty">
          <Icon name="grid" size={28} />
          <b>No room panel open</b>
          <p>{devBackend ? "Open a mocked room to start. Your real rooms are untouched and come back when you leave the DevBackend." : "Open a room to see its widgets."}</p>
          <Button kind="primary" icon="plus" onClick={() => dispatch({ type: "panel/new" })}>
            New room panel
          </Button>
          <span className="muted">
            <kbd>Alt</kbd> + <kbd>N</kbd>
          </span>
        </div>
      </main>
    );
  }

  // In a narrow window only the focused panel is visible (the first one if none is marked).
  const shownId = panels.some((p) => p.id === roomsArea?.focusedPanelId) ? roomsArea?.focusedPanelId : panels[0].id;
  const visible = narrow ? panels.filter((p) => p.id === shownId) : panels;

  return (
    <main className="roomsarea" data-testid="roomsarea">
      {visible.map((panel, i) => (
        <Fragment key={panel.id}>
          {i > 0 && <PanelSeparator left={visible[i - 1]} right={panel} />}
          <RoomPanel main={main} settings={settings} panel={panel} focused={panel.id === roomsArea?.focusedPanelId} fullscreen={fullscreen} renderWidget={renderWidget} />
        </Fragment>
      ))}
    </main>
  );
}

/**
 * The drag handle between two room panels. It lies over the gap (8px) and changes the share of
 * the panel on its left; the two neighbours keep their common width.
 */
function PanelSeparator({ left, right }: { left: RoomPanelViewModel; right: RoomPanelViewModel }) {
  const dispatch = useDispatch();
  const drag = useRef<{ startX: number; leftWidth: number; total: number } | undefined>(undefined);
  const sum = left.widthShare + right.widthShare;

  /** The current widths of the two neighbours, in px. */
  const widths = (separator: Element) => {
    const leftWidth = separator.previousElementSibling?.getBoundingClientRect().width ?? 0;
    const rightWidth = separator.nextElementSibling?.getBoundingClientRect().width ?? 0;
    return { leftWidth, total: leftWidth + rightWidth };
  };

  // TODO-FINDING panel-resize-intent-semantics - `panel/resize` carries one panel and its share. The separator sends it for the LEFT panel only and expects the controller to give the rest of the pair's sum to the right neighbour (else dragging would not move the border but squeeze all panels). The reset sends two intents (both panels to 1). An intent `{ leftPanelId, leftShare, rightShare }` would say it without the assumption.
  const resizeTo = (leftWidth: number, total: number) => {
    if (total <= 0) return;
    const min = Math.min(MIN_PANEL_WIDTH, total / 2);
    const width = Math.min(Math.max(leftWidth, min), total - min);
    const widthShare = Math.round(((sum * width) / total) * 1000) / 1000;
    if (widthShare !== left.widthShare) dispatch({ type: "panel/resize", panelId: left.id, widthShare });
  };
  const reset = () => {
    dispatch({ type: "panel/resize", panelId: left.id, widthShare: 1 });
    dispatch({ type: "panel/resize", panelId: right.id, widthShare: 1 });
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, ...widths(e.currentTarget) };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) resizeTo(drag.current.leftWidth + e.clientX - drag.current.startX, drag.current.total);
  };
  const endDrag = () => {
    drag.current = undefined;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const { leftWidth, total } = widths(e.currentTarget);
    const to = { ArrowLeft: leftWidth - KEY_STEP, ArrowRight: leftWidth + KEY_STEP, Home: 0, End: total }[e.key];
    if (to !== undefined) {
      e.preventDefault();
      resizeTo(to, total);
    } else if (e.key === "Enter") {
      e.preventDefault();
      reset();
    }
  };

  return (
    <div
      className="rp-sep"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize room panels"
      aria-valuenow={Math.round((100 * left.widthShare) / sum)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      title="Drag or use the arrow keys to resize · double click or Enter to reset"
      data-testid="room-panel-separator"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={reset}
      onKeyDown={onKeyDown}
    >
      <i />
    </div>
  );
}
