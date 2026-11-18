import { createContext, useContext, type PointerEvent } from "react";

import type { PanelId, RoomId, TabId } from "../../appViewModel";

/**
 * `pointerdown` handlers that start dragging a room panel (by its header) or a tab in the
 * RoomsArea's `DockArea`. Provided by the RoomsArea; without it (a panel alone in a narrow window,
 * the stories of a single view) nothing is draggable.
 */
export interface RoomsDrag {
  /** The header of a panel: its room name tab and the free space. `roomId`: unset for a picker. */
  panel(panel: { panelId: PanelId; roomId?: RoomId; label: string }): (e: PointerEvent<HTMLElement>) => void;
  tab(tab: { panelId: PanelId; roomId: RoomId; tabId: TabId; label: string }): (e: PointerEvent<HTMLElement>) => void;
}

export const RoomsDragContext = createContext<RoomsDrag | undefined>(undefined);

export const useRoomsDrag = (): RoomsDrag | undefined => useContext(RoomsDragContext);
