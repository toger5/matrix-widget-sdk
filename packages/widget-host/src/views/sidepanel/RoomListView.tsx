import type { MainViewModel } from "../../appViewModel";
import { plural, readyRooms } from "../helpers";
import { RoomPicker } from "../rooms/RoomPicker";
import { SideBox } from "./SideBox";

export interface RoomListViewProps {
  main: MainViewModel;
}

/** The Room list of the SidePanel: the RoomPicker in a side box. A pick opens in a room panel (`room/open`). stories `sidepanel-sidepanel--room-list`, `app-appshell--room-list` */
export function RoomListView({ main }: RoomListViewProps) {
  const sub = main.data.rooms.status === "ready" ? plural(readyRooms(main).length, "room") : undefined;
  return (
    <SideBox title="Rooms" sub={sub} className="rooms" testId="room-list-view">
      <RoomPicker main={main} />
    </SideBox>
  );
}
