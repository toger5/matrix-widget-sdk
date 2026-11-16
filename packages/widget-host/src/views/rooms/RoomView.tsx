import type { ReactNode } from "react";

import type { MainViewModel, PanelId, RoomViewModel, SettingsViewModel } from "../../appViewModel";
import type { RenderWidget } from "../app/AppShell";
import { roomOf } from "../helpers";
import { RoomOverview } from "./RoomOverview";
import { RoomTimeline } from "./RoomTimeline";
import { TabBar } from "./TabBar";
import { roomTabDomId, tabDomId, tabPanelDomId } from "./tabInfo";

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
 * A tabbed room: the header (the room name tab, the tabs of widgets and the timeline) and the body
 * of the selected tab: the shown widget, the RoomTimeline, or the RoomOverview while the room name
 * is selected. It renders the two children of a `.roompanel`, so it is used inside a `RoomPanel`.
 * leaves roomview/*, tabs/*, overview/*, timeline/*, roomview2/*
 */
export function RoomView({ main, settings, panelId, content, fullscreen = false, renderWidget, headerEnd }: RoomViewProps) {
  const { roomId, tabs, activeTabId } = content;
  const room = roomOf(main, roomId);
  const name = room?.name ?? roomId;
  // Without an active tab the room name is selected. Never fall back to "the first tab": `widgetTab().shown`
  // (and so the PiP panel) only looks at `activeTabId`, and a widget must be on screen at most once.
  const active = tabs.find((t) => t.id === activeTabId);

  return (
    <>
      {/* TODO-FINDING fullscreen-close-button - appDesign.md ("Custom behavior") says "no close button shown" in fullscreen; the leaves app/fullscreen(-hover) still draw "Close panel". For now it is hidden like the tab and the + button, and comes back with them on hover / focus (else the panel could not be closed without expanding the LeftBar). */}
      <header className={`rp-head ${fullscreen ? "fs" : ""}`}>
        <TabBar main={main} settings={settings} panelId={panelId} roomId={roomId} room={room} roomName={name} tabs={tabs} activeTabId={active?.id} fullscreen={fullscreen} />
        <span className="sp" />
        {headerEnd}
      </header>
      <div className="rp-body" id={tabPanelDomId(panelId)} role="tabpanel" aria-labelledby={active ? tabDomId(panelId, active.id) : roomTabDomId(panelId)} data-testid="room-view" data-room-id={roomId}>
        {active?.kind === "widget" ? (
          renderWidget(active.widgetId)
        ) : active?.kind === "timeline" ? (
          <RoomTimeline roomId={roomId} />
        ) : (
          <RoomOverview main={main} panelId={panelId} roomId={roomId} devTools={settings.devTools} timelineOpen={tabs.some((t) => t.kind === "timeline")} />
        )}
      </div>
    </>
  );
}
