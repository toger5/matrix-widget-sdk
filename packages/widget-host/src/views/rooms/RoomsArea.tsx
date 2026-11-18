import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

import { activeAccount, activeWorkspace, type AppIntent, type MainViewModel, type PanelId, type RoomsAreaViewModel, type SettingsViewModel } from "../../appViewModel";
import type { DockLayout } from "../../dock/dockLayout";
import type { RenderWidget } from "../app/AppShell";
import { DockArea, type DockAreaHandle, type DragItem } from "../dock/DockArea";
import { dragChip, dragStarter } from "../dock/dragStart";
import { useDispatch, useViewEnv } from "../env";
import { Button, Icon } from "../ui/atoms";
import { RoomPanel } from "./RoomPanel";
import { RoomsDragContext, type RoomsDrag } from "./roomsDrag";

export interface RoomsAreaProps {
  main: MainViewModel;
  settings: SettingsViewModel;
  /** `fullscreenWidget(vm)` is set: the single panel has no rounded container, its header hides tab and + until hovered or focused. */
  fullscreen: boolean;
  renderWidget: RenderWidget;
}

/** "Every resizable panel has a minimum size." */
export const MIN_PANEL_WIDTH = 280;
export const MIN_PANEL_HEIGHT = 200;

/** stories `app-appshell--one-panel`, `app-appshell--several-panels`, `app-appshell--panel-rows`, `app-appshell--different-rooms`, `app-appshell--same-room-twice`; its parts: `rooms-*--*`. The `<main class="roomsarea">` with its room panels. */
export function RoomsArea({ main, settings, fullscreen, renderWidget }: RoomsAreaProps) {
  const dispatch = useDispatch();
  const { narrow } = useViewEnv();
  const roomsArea = activeWorkspace(main)?.roomsArea;
  const panels = roomsArea?.panels ?? [];

  if (!roomsArea || panels.length === 0) {
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

  // In a narrow window only the focused panel is visible (the first one if none is marked), without the dock.
  if (narrow) {
    const shown = panels.find((p) => p.id === roomsArea.focusedPanelId) ?? panels[0];
    return (
      <main className="roomsarea" data-testid="roomsarea">
        <RoomPanel main={main} settings={settings} panel={shown} focused={shown.id === roomsArea.focusedPanelId} fullscreen={fullscreen} renderWidget={renderWidget} />
      </main>
    );
  }

  return <DockedPanels main={main} settings={settings} roomsArea={roomsArea} fullscreen={fullscreen} renderWidget={renderWidget} />;
}

let counter = 0;
/** Ids of panels made by a tab dropped on a gap; unique within the stored layout, like the controller's. */
const newPanelId = () => `panel-${Date.now().toString(36)}-d${(counter++).toString(36)}`;

/**
 * The panels in a `DockArea`. Each panel is rendered (a portal) into a container element of its
 * own, made once, which the dock moves into its cell: React keeps the panel, and its widgets are
 * `<slot>`s, so moving a panel reloads no iframe.
 */
function DockedPanels({ main, settings, roomsArea, fullscreen, renderWidget }: Omit<RoomsAreaProps, "main"> & { main: MainViewModel; roomsArea: RoomsAreaViewModel }) {
  const dispatch = useDispatch();
  const dock = useRef<DockAreaHandle>(null);
  const containers = useRef(new Map<PanelId, HTMLElement>());
  const containerFor = (id: PanelId) => {
    let el = containers.current.get(id);
    if (!el) {
      el = document.createElement("div");
      el.className = "roompanel-host";
      containers.current.set(id, el);
    }
    return el;
  };
  for (const panel of roomsArea.panels) containerFor(panel.id);
  useEffect(() => {
    const ids = new Set(roomsArea.panels.map((p) => p.id));
    for (const id of containers.current.keys()) if (!ids.has(id)) containers.current.delete(id);
  });

  // What the drop of the current drag means; the dock's `onLayoutChange` follows the drop at once.
  const pending = useRef<((next: DockLayout) => AppIntent) | undefined>(undefined);
  const onLayoutChange = (next: DockLayout) => {
    const intent = pending.current;
    pending.current = undefined;
    dispatch(intent ? intent(next) : { type: "panel/arrange", dock: next });
  };

  const drag = useMemo<RoomsDrag>(() => {
    const item = (label: string, roomId: string | undefined, drop: DragItem["drop"]): Omit<DragItem, "sourceId" | "originId"> => ({
      element: dragChip(label),
      ...(roomId === undefined ? {} : { group: roomId }),
      cancel() {
        pending.current = undefined;
      },
      drop,
    });
    return {
      panel: ({ panelId, roomId, label }) =>
        dragStarter(
          dock,
          () => ({
            ...item(label, roomId, (target, itemId) => {
              pending.current = target.kind === "into" ? () => ({ type: "panel/merge", panelId, intoPanelId: itemId }) : undefined;
              return containerFor(itemId);
            }),
            sourceId: panelId,
          }),
          // the buttons of the header (tabs, +, ×) are no handle; the room name tab is
          "button:not(.room-chip), .tab",
        ),
      tab: ({ panelId, roomId, tabId, label }) =>
        dragStarter(dock, () => ({
          ...item(label, roomId, (target, itemId) => {
            pending.current =
              target.kind === "into" ? () => ({ type: "tab/toPanel", panelId, tabId, intoPanelId: itemId }) : (next) => ({ type: "tab/split", panelId, tabId, newPanelId: itemId, dock: next });
            return containerFor(itemId);
          }),
          originId: panelId,
        })),
    };
    // made once: it only reads refs
  }, []);

  return (
    <RoomsDragContext.Provider value={drag}>
      <main className="roomsarea" data-testid="roomsarea">
        <DockArea ref={dock} layout={roomsArea.dock} elements={containers.current} onLayoutChange={onLayoutChange} newId={newPanelId} minItemWidth={MIN_PANEL_WIDTH} minItemHeight={MIN_PANEL_HEIGHT} />
      </main>
      {roomsArea.panels.map((panel) =>
        createPortal(
          <RoomPanel main={main} settings={settings} panel={panel} focused={panel.id === roomsArea.focusedPanelId} fullscreen={fullscreen} renderWidget={renderWidget} />,
          containerFor(panel.id),
          panel.id,
        ),
      )}
    </RoomsDragContext.Provider>
  );
}
