import type { ReactNode } from "react";

import { activeAccount, type MainViewModel, type PanelId, type RoomDevToolsLayout, type RoomId, type RoomViewModel, type SettingsViewModel, type TabId } from "../../appViewModel";
import type { RenderWidget } from "../app/AppShell";
import { RoomDevTools } from "../devbackend/RoomDevTools";
import { useViewEnv } from "../env";
import { roomOf } from "../helpers";
import { RoomOverview } from "./RoomOverview";
import { useRoomsDrag } from "./roomsDrag";
import { RoomTimeline } from "./RoomTimeline";
import { TabBar } from "./TabBar";
import { roomTabDomId, tabDomId, tabPanelDomId } from "./tabInfo";

export interface RoomViewProps {
  main: MainViewModel;
  settings: SettingsViewModel;
  panelId: PanelId;
  content: RoomViewModel;
  /** The header hides the tab bar, the + and the close button until it is hovered or has the focus inside. stories `app-appshell--fullscreen*` */
  fullscreen?: boolean;
  renderWidget: RenderWidget;
  /** Rendered at the end of the header: the "Close panel" button of the RoomPanel. */
  headerEnd?: ReactNode;
}

/**
 * A tabbed room: the header (the room name tab, the tabs of widgets, the timeline and the room dev
 * tools) and the body of the selected tab: the shown widget, the RoomTimeline, the room dev tools,
 * or the RoomOverview while the room name is selected. It renders the two children of a `.roompanel`, so it is used inside a `RoomPanel`.
 * stories `rooms-roomview--*`, `rooms-tabbar--*`, `rooms-roomoverview--*`, `rooms-roomtimeline--*`, `rooms-roomdevtools--*`, `app-appshell--different-rooms`, `app-appshell--same-room-twice`
 */
export function RoomView({ main, settings, panelId, content, fullscreen = false, renderWidget, headerEnd }: RoomViewProps) {
  const { roomId, tabs, activeTabId } = content;
  const room = roomOf(main, roomId);
  const name = room?.name ?? roomId;
  // Without an active tab the room name is selected. Never fall back to "the first tab": `widgetTab().shown`
  // (and so the PiP panel) only looks at `activeTabId`, and a widget must be on screen at most once.
  const active = tabs.find((t) => t.id === activeTabId);
  // In the RoomsArea the header (the room name and the free space) moves the panel.
  const drag = useRoomsDrag();

  return (
    <>
      {/* TODO-FINDING fullscreen-close-button - appDesign.md ("Custom behavior") says "no close button shown" in fullscreen; the design drew "Close panel" in the fullscreen header. For now it is hidden like the tab and the + button, and comes back with them on hover / focus (else the panel could not be closed without expanding the LeftBar). */}
      <header className={`rp-head ${fullscreen ? "fs" : ""}`} onPointerDown={drag?.panel({ panelId, roomId, label: name })}>
        <TabBar main={main} settings={settings} panelId={panelId} roomId={roomId} room={room} roomName={name} tabs={tabs} activeTabId={active?.id} fullscreen={fullscreen} />
        <span className="sp" />
        {headerEnd}
      </header>
      <div className="rp-body" id={tabPanelDomId(panelId)} role="tabpanel" aria-labelledby={active ? tabDomId(panelId, active.id) : roomTabDomId(panelId)} data-testid="room-view" data-room-id={roomId}>
        {active?.kind === "widget" ? (
          renderWidget(active.widgetId)
        ) : active?.kind === "timeline" ? (
          <RoomTimeline roomId={roomId} />
        ) : active?.kind === "roomTools" ? (
          // TODO-FINDING room-dev-tools-tab-without-dev-tools - a room dev tools tab stays (and works) when dev tools are turned off, until it is closed; only "Open room dev tools" needs them.
          <RoomToolsTab main={main} panelId={panelId} roomId={roomId} tabId={active.id} layout={active.layout} />
        ) : (
          <RoomOverview
            main={main}
            panelId={panelId}
            roomId={roomId}
            devTools={settings.devTools}
            devBackend={settings.devBackend}
            timelineOpen={tabs.some((t) => t.kind === "timeline")}
            roomToolsOpen={tabs.some((t) => t.kind === "roomTools")}
          />
        )}
      </div>
    </>
  );
}

/**
 * The room dev tools of a room dev tools tab: the panel's room, no dropdown, never the DevBackend's
 * tools. While the DevBackend is active, a mocked room (any sender, its scheduled events and a
 * widget's pagination request); else the room as the account. stories `rooms-roomdevtools--*`
 */
function RoomToolsTab({ main, panelId, roomId, tabId, layout }: { main: MainViewModel; panelId: PanelId; roomId: RoomId; tabId: TabId; layout: RoomDevToolsLayout }) {
  const mocked = useViewEnv().useMockedRoomData(roomId);
  const account = activeAccount(main);
  const dev = account?.kind === "devBackend";
  const forms = main.roomTools ?? { sendForm: "message", stateForm: "testWidget" };
  return (
    <RoomDevTools
      mode={dev ? "devBackend" : "account"}
      roomId={roomId}
      layout={layout}
      target={{ in: "tab", panelId, tabId }}
      forms={forms}
      userId={dev ? mocked.userId : account?.userId}
      scheduled={dev ? mocked.scheduled : (main.roomTools?.scheduled[main.activeAccountId]?.[roomId] ?? [])}
      pagination={dev ? mocked.pagination : undefined}
    />
  );
}
