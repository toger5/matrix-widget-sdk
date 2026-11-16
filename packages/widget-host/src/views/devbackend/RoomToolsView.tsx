import { activeAccount, roomToolsRoomId, roomToolsRooms, type MainViewModel, type RoomToolsViewModel } from "../../appViewModel";
import { useDispatch } from "../env";
import { roomOf } from "../helpers";
import { Icon } from "../ui/atoms";
import { RoomBox, type RoomToolsRoom } from "./RoomBox";

export interface RoomToolsViewProps {
  /** A Matrix account is active (with the DevBackend active, the SidePanel shows the DevBackendView). */
  main: MainViewModel;
  roomTools: RoomToolsViewModel;
  /** `canSwitchToDevBackend`: the DevBackend is enabled, so "Switch to the DevBackend" is at the bottom. */
  canSwitchToDevBackend: boolean;
}

/**
 * The Dev tools of a Matrix account: the room box of the rooms
 * open in the room panels (`roomToolsRooms`), everything sent as the account, and "Switch to the
 * DevBackend" at the bottom. stories `sidepanel-roomtoolsview--*`
 */
export function RoomToolsView({ main, roomTools, canSwitchToDevBackend }: RoomToolsViewProps) {
  const dispatch = useDispatch();
  const rooms = roomToolsRooms(main).map((id): RoomToolsRoom => {
    const room = roomOf(main, id);
    return { id, name: room?.name || id, ...(room?.avatarUrl ? { avatarUrl: room.avatarUrl } : {}) };
  });
  const roomId = roomToolsRoomId(main);
  const scheduled = (roomId !== undefined && roomTools.scheduled[main.activeAccountId]?.[roomId]) || [];

  return (
    <>
      <RoomBox mode="account" rooms={rooms} roomId={roomId} roomTools={roomTools} userId={activeAccount(main)?.userId} scheduled={scheduled} />
      {canSwitchToDevBackend && (
        <button
          type="button"
          className="leave-link"
          title="Mocked rooms in memory, without a homeserver. Your room panels close and come back when you leave the DevBackend."
          onClick={() => dispatch({ type: "devBackend/activate" })}
        >
          Switch to the DevBackend
          <Icon name="cone" size={14} />
        </button>
      )}
    </>
  );
}
