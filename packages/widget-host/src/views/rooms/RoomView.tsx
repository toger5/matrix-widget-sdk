import type { ReactNode } from "react";

import type { MainViewModel, PanelId, RoomViewModel, SettingsViewModel } from "../../appViewModel";
import type { RenderWidget } from "../app/AppShell";
import { useDispatch } from "../env";
import { roomOf, roomWidgets } from "../helpers";
import { Avatar, Icon } from "../ui/atoms";
import { RoomOverview } from "./RoomOverview";
import { TabBar } from "./TabBar";
import { tabDomId, tabPanelDomId } from "./tabInfo";
import { WidgetTiles } from "./WidgetTiles";

export interface RoomViewProps {
  main: MainViewModel;
  settings: SettingsViewModel;
  panelId: PanelId;
  content: RoomViewModel;
  /** The header hides the tab bar, the + and the close button until it is hovered or has the focus inside. leaves app/fullscreen* */
  fullscreen?: boolean;
  renderWidget: RenderWidget;
  /** Rendered at the end of the header: the "Close panel" button of the RoomPanel. */
  headerEnd?: ReactNode;
}

/**
 * A tabbed room: the header (room chip + tab bar) and the body of the active tab. It renders the
 * two children of a `.roompanel`, so it is used inside a `RoomPanel`. leaves roomview/*, tabs/*, roomview2/*
 */
export function RoomView({ main, settings, panelId, content, fullscreen = false, renderWidget, headerEnd }: RoomViewProps) {
  const dispatch = useDispatch();
  const { roomId, tabs, activeTabId } = content;
  const room = roomOf(main, roomId);
  const name = room?.name ?? roomId;
  const widgetCount = roomWidgets(room).length;
  // Without an active tab the body shows the tiles. Never fall back to "the first tab": `widgetTab().shown`
  // (and so the PiP panel) only looks at `activeTabId`, and a widget must be on screen at most once.
  const active = tabs.find((t) => t.id === activeTabId);

  let body: ReactNode;
  if (!active) body = <WidgetTiles main={main} panelId={panelId} roomId={roomId} />;
  else if (active.kind === "widget") body = renderWidget(active.widgetId);
  else if (active.kind === "new") body = <WidgetTiles main={main} panelId={panelId} roomId={roomId} tabId={active.id} />;
  else body = <RoomOverview main={main} panelId={panelId} roomId={roomId} devTools={settings.devTools} />;

  return (
    <>
      {/* TODO-FINDING fullscreen-close-button - appDesign.md ("Custom behavior") says "no close button shown" in fullscreen; the leaves app/fullscreen(-hover) still draw "Close panel". For now it is hidden like the tab and the + button, and comes back with them on hover / focus (else the panel could not be closed without expanding the LeftBar). */}
      <header className={`rp-head ${fullscreen ? "fs" : ""}`}>
        <button type="button" className="room-chip" title={`${name} · open the room overview`} data-room-id={roomId} onClick={() => dispatch({ type: "tab/openRoomOverview", panelId })}>
          <Avatar name={name} id={roomId} size={24} square mxc={room?.avatarUrl} />
          <span className="room-name">{name}</span>
          {room && (
            <span className="room-counts">
              {room.widgetEvents !== undefined && (
                <span title={`${widgetCount} ${widgetCount === 1 ? "widget" : "widgets"}`}>
                  <Icon name="grid" size={12} />
                  {widgetCount}
                  <span className="vh">{widgetCount === 1 ? " widget" : " widgets"}</span>
                </span>
              )}
              {room.memberCount !== undefined && (
                <span title={`${room.memberCount} ${room.memberCount === 1 ? "member" : "members"}`}>
                  <Icon name="users" size={12} />
                  {room.memberCount}
                  <span className="vh">{room.memberCount === 1 ? " member" : " members"}</span>
                </span>
              )}
            </span>
          )}
        </button>
        <TabBar main={main} settings={settings} panelId={panelId} room={room} roomName={name} tabs={tabs} activeTabId={active?.id} />
        <span className="sp" />
        {headerEnd}
      </header>
      <div
        className="rp-body"
        id={tabPanelDomId(panelId)}
        role={active ? "tabpanel" : undefined}
        aria-labelledby={active ? tabDomId(panelId, active.id) : undefined}
        data-testid="room-view"
        data-room-id={roomId}
      >
        {body}
      </div>
    </>
  );
}
