import { useRef, type KeyboardEvent, type PointerEvent } from "react";

import { activeAccount, canLeaveDevBackend, type MainViewModel, type SettingsViewModel } from "../../appViewModel";
import { DevBackendView } from "../devbackend/DevBackendView";
import { RoomToolsView } from "../devbackend/RoomToolsView";
import { useDispatch, useViewEnv } from "../env";
import { AccountView } from "./AccountView";
import { RoomListView } from "./RoomListView";
import { SettingsView } from "./SettingsView";

export interface SidePanelProps {
  main: MainViewModel;
  settings: SettingsViewModel;
}

export const SIDE_PANEL_MIN_WIDTH = 260;
export const SIDE_PANEL_MAX_WIDTH = 560;
export const SIDE_PANEL_DEFAULT_WIDTH = 324;
const KEY_STEP = 16;

const clampWidth = (width: number) => Math.round(Math.min(SIDE_PANEL_MAX_WIDTH, Math.max(SIDE_PANEL_MIN_WIDTH, width)));

/** The drag handle on the right edge of the column: drag, arrow keys (Home/End: smallest/largest), double click or Enter resets. */
function ResizeHandle({ width }: { width: number }) {
  const dispatch = useDispatch();
  const drag = useRef<{ startX: number; startWidth: number } | undefined>(undefined);
  const resize = (to: number) => {
    const next = clampWidth(to);
    if (next !== width) dispatch({ type: "sidePanel/resize", width: next });
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: width };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) resize(drag.current.startWidth + e.clientX - drag.current.startX);
  };
  const onPointerEnd = () => {
    drag.current = undefined;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const to =
      e.key === "ArrowLeft" ? width - KEY_STEP
      : e.key === "ArrowRight" ? width + KEY_STEP
      : e.key === "Home" ? SIDE_PANEL_MIN_WIDTH
      : e.key === "End" ? SIDE_PANEL_MAX_WIDTH
      : e.key === "Enter" ? SIDE_PANEL_DEFAULT_WIDTH
      : undefined;
    if (to === undefined) return;
    e.preventDefault();
    resize(to);
  };

  return (
    <div
      className="side-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize side panel"
      aria-valuenow={width}
      aria-valuemin={SIDE_PANEL_MIN_WIDTH}
      aria-valuemax={SIDE_PANEL_MAX_WIDTH}
      tabIndex={0}
      title="Drag to resize · double click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={() => resize(SIDE_PANEL_DEFAULT_WIDTH)}
      onKeyDown={onKeyDown}
    />
  );
}

/**
 * The column next to the LeftBar: AccountView, SettingsView, the Room list or the Dev tools (the
 * DevBackendView while the DevBackend is active) by `main.sidePanel.view`; nothing while closed.
 * leaves sidepanel/*, roomtools/*, devbackend/*
 */
export function SidePanel({ main, settings }: SidePanelProps) {
  const { narrow } = useViewEnv();
  const { view } = main.sidePanel;
  const { roomTools } = main;
  if (!view) return null;
  if (view === "roomTools" && !roomTools) return null;
  const width = clampWidth(main.sidePanel.width);
  const devBackendActive = activeAccount(main)?.kind === "devBackend";

  return (
    <div className="sidecol" style={{ width }} data-testid="sidepanel" data-view={view}>
      {view === "account" && <AccountView accounts={main.accounts} activeAccountId={main.activeAccountId} />}
      {view === "settings" && <SettingsView settings={settings} devBackendActive={devBackendActive} />}
      {view === "rooms" && <RoomListView main={main} />}
      {view === "roomTools" &&
        roomTools &&
        (devBackendActive ? (
          <DevBackendView roomTools={roomTools} roomId={roomTools.selectedRoomIds[main.activeAccountId]} canLeave={canLeaveDevBackend(main)} />
        ) : (
          // Per account: another account's view of the same room starts afresh (its reads, the drafts).
          <RoomToolsView key={main.activeAccountId} main={main} roomTools={roomTools} canSwitchToDevBackend={settings.devBackend} />
        ))}
      {/* TODO-FINDING narrow-side-panel-width - in a narrow window the panel overlays and has no resize handle; it keeps the persisted width, capped to the window by CSS. */}
      {!narrow && <ResizeHandle width={width} />}
    </div>
  );
}
