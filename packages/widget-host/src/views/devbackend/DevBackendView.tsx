import type { RoomId, RoomToolsViewModel } from "../../appViewModel";
import { useDispatch, useViewEnv } from "../env";
import { Icon } from "../ui/atoms";
import { ClientBox } from "./ClientBox";
import { MediaBox, filesLabel } from "./MediaBox";
import { RoomBox } from "./RoomBox";
import { ToolButton, ToolSeparator } from "./ToolBox";

export interface DevBackendViewProps {
  roomTools: RoomToolsViewModel;
  /** The mocked room picked in the dropdown (`selectedRoomIds` of the DevBackend account). */
  roomId?: RoomId;
  /** `canLeaveDevBackend`: without an account to go back to, "Leave DevBackend" is not shown. */
  canLeave: boolean;
}

/**
 * The Dev tools while the DevBackend is active. stories `sidepanel-devbackendview*--*`. The mocked rooms, their
 * scheduled events and the tools' data come from `useViewEnv().useMockedRoomData()`. It renders the
 * children of the SidePanel column (`.sidecol`): the room box (`RoomBox`), the tools (the Client
 * Backend Tool and the Media Backend Tool, each a button or, at most one, its box) and the leave link.
 */
// TODO-FINDING devbackend-extra-store-tools - the old app had store tools without a place in the design: push TURN credentials, set room account data, set RTC transports, fire the oldest delayed event. Not ported.
// TODO-FINDING devbackend-raw-form-shape - the raw JSON form is one editor for the whole event ({ type, sender, content }) as in story `sidepanel-devbackendview--timeline-raw-json`, not separate type + content fields.
export function DevBackendView({ roomTools, roomId, canLeave }: DevBackendViewProps) {
  const dispatch = useDispatch();
  const data = useViewEnv().useMockedRoomData();
  const tools = roomTools.tools;

  return (
    <>
      <RoomBox mode="devBackend" rooms={data.rooms} roomId={roomId} roomTools={roomTools} userId={data.userId} scheduled={data.scheduled} />
      {tools.open === "client" ? (
        <>
          <ToolSeparator tool="client" heightShare={tools.heightShare} />
          <ClientBox openSections={roomTools.openSections} heightShare={tools.heightShare} behavior={roomTools.behavior} data={data} />
        </>
      ) : (
        <ToolButton tool="client" />
      )}
      {tools.open === "media" ? (
        <>
          <ToolSeparator tool="media" heightShare={tools.heightShare} />
          <MediaBox media={data.media} heightShare={tools.heightShare} />
        </>
      ) : (
        <ToolButton tool="media" count={filesLabel(data.media.length)} />
      )}
      {canLeave && (
        <button type="button" className="leave-link" title="Back to your Matrix account. The mocked rooms are kept." onClick={() => dispatch({ type: "devBackend/leave" })}>
          Leave DevBackend
          <Icon name="logout" size={14} />
        </button>
      )}
    </>
  );
}
