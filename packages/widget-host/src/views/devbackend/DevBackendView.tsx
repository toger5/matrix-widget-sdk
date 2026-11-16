import type { CSSProperties } from "react";

import type { DevBackendSection, DevBackendViewModel, MockedRoomData } from "../../appViewModel";
import { useDispatch, useViewEnv } from "../env";
import { Avatar, Button, Icon, IconButton } from "../ui/atoms";
import { MediaBox, MediaButton, MediaSeparator } from "./MediaBox";
import { BehaviorSection, ToDeviceSection } from "./OtherSections";
import { Acc, usePopup } from "./parts";
import { StateSection } from "./StateSection";
import { TimelineSection } from "./TimelineSection";

export interface DevBackendViewProps {
  devBackend: DevBackendViewModel;
  /** `canLeaveDevBackend`: without an account to go back to, "Leave DevBackend" is not shown. */
  canLeave: boolean;
}

type MockedRoom = MockedRoomData["rooms"][number];

/**
 * leaves devbackend/*. The content of the mocked rooms comes from `useViewEnv().useMockedRoomData()`.
 * It renders the children of the SidePanel column (`.sidecol`): the room box, the media box or
 * its button, and the leave link.
 */
// TODO-FINDING devbackend-extra-store-tools - the old app had store tools without a place in the design: push TURN credentials, set room account data, set RTC transports, fire the oldest delayed event. Not ported.
// TODO-FINDING devbackend-raw-form-shape - the raw JSON form is one editor for the whole event ({ type, sender, content }) as in leaf devbackend/timeline-raw, not separate type + content fields.
export function DevBackendView({ devBackend, canLeave }: DevBackendViewProps) {
  const dispatch = useDispatch();
  const data = useViewEnv().useMockedRoomData();
  const room = data.rooms.find((r) => r.id === devBackend.selectedRoomId);
  const isOpen = (section: DevBackendSection) => devBackend.openSections.includes(section);
  const toggle = (section: DevBackendSection) => () => dispatch({ type: "mock/toggleSection", section });
  const members = data.state.filter((e) => e.type === "m.room.member").map((e) => e.stateKey);
  const stateTypes = new Set(data.state.map((e) => e.type)).size;

  return (
    <>
      <section className="sidebox devb" data-testid="devbackend-view" data-room-id={room?.id}>
        <header className="side-head">
          <RoomHeader rooms={data.rooms} room={room} />
          {/* TODO-FINDING devbackend-header-buttons - the mockup's header is only the room dropdown. "Close panel" (as in the other SidePanel views) and the "Room actions" menu (clear room, remove room) were added next to it; neither is drawn. */}
          <IconButton icon="x" title="Close panel" onClick={() => dispatch({ type: "sidePanel/close" })} />
        </header>
        <div className="side-body">
          {room ? (
            <>
              <Acc id="state" title="State" open={isOpen("state")} count={`${stateTypes} type${stateTypes === 1 ? "" : "s"}`} onToggle={toggle("state")}>
                <StateSection key={room.id} roomId={room.id} state={data.state} stateForm={devBackend.stateForm} userId={data.userId} />
              </Acc>
              <Acc id="timeline" title="Timeline" open={isOpen("timeline")} count={`${data.timeline.length} event${data.timeline.length === 1 ? "" : "s"}`} onToggle={toggle("timeline")}>
                <TimelineSection key={room.id} roomId={room.id} sendForm={devBackend.sendForm} timeline={data.timeline} scheduled={data.scheduled} userId={data.userId} members={members} />
              </Acc>
              <Acc id="widgetHostBehavior" title="Widget host behavior" open={isOpen("widgetHostBehavior")} onToggle={toggle("widgetHostBehavior")}>
                <BehaviorSection roomId={room.id} behavior={devBackend.behavior[room.id]} />
              </Acc>
              {/* TODO-FINDING devbackend-todevice-placement - to-device messages are account-wide but shown in the per-room page (designFeedback "Still open" 7). Kept as in the mockup. */}
              <Acc id="toDevice" title="To-device messages" open={isOpen("toDevice")} count={String(data.toDevice.length)} onToggle={toggle("toDevice")}>
                <ToDeviceSection toDevice={data.toDevice} userId={data.userId} />
              </Acc>
            </>
          ) : data.rooms.length ? (
            <div className="empty">
              <Icon name="cone" size={28} />
              <b>No room selected</b>
              <p>Pick a mocked room in the dropdown above.</p>
            </div>
          ) : (
            <div className="empty">
              <Icon name="cone" size={28} />
              <b>No mocked rooms yet</b>
              <p>Create an empty room, or copy a real one from its room overview (Dev tools › Copy to DevBackend).</p>
              <Button kind="primary" icon="plus" onClick={() => dispatch({ type: "mock/addRoom" })}>
                Create a room
              </Button>
            </div>
          )}
        </div>
      </section>
      {devBackend.media.open ? (
        <>
          <MediaSeparator heightShare={devBackend.media.heightShare} />
          <MediaBox media={data.media} heightShare={devBackend.media.heightShare} />
        </>
      ) : (
        <MediaButton count={data.media.length} />
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

/** The room name + id with the room dropdown, and the menu with the actions on the selected room (mockup function `roomMenu`). leaf devbackend/dropdown */
function RoomHeader({ rooms, room }: { rooms: MockedRoom[]; room?: MockedRoom }) {
  const dispatch = useDispatch();
  const picker = usePopup();
  const actions = usePopup();

  if (!rooms.length) {
    return (
      <div className="room-pick none">
        <span className="av sq ghost" style={{ "--s": "28px" } as CSSProperties} aria-hidden="true">
          <Icon name="hash" size={14} />
        </span>
        <div className="side-title">
          <b>No mocked room</b>
          <small>DevBackend</small>
        </div>
        <Icon name="chevDown" size={14} className="end" />
      </div>
    );
  }
  return (
    <>
      <button ref={picker.triggerRef} type="button" className={`room-pick ${picker.open ? "open" : ""}`} aria-haspopup="listbox" aria-expanded={picker.open} onClick={picker.toggle}>
        {room ? (
          <Avatar name={room.name} id={room.id} size={28} square mxc={room.avatarUrl} />
        ) : (
          <span className="av sq ghost" style={{ "--s": "28px" } as CSSProperties} aria-hidden="true">
            <Icon name="hash" size={14} />
          </span>
        )}
        <div className="side-title">
          <b>{room?.name ?? "No room selected"}</b>
          <small className="mono">{room?.id ?? "DevBackend"}</small>
        </div>
        <Icon name="chevDown" size={14} className="end" />
      </button>
      {picker.open && (
        <div ref={picker.popupRef} className="dropdown" onKeyDown={picker.onKeyDown}>
          <div role="listbox" aria-label="Mocked rooms">
            {rooms.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`dd-row ${r.id === room?.id ? "on" : ""}`}
                role="option"
                aria-selected={r.id === room?.id}
                data-room-id={r.id}
                onClick={() => {
                  picker.close();
                  if (r.id !== room?.id) dispatch({ type: "mock/selectRoom", roomId: r.id });
                }}
              >
                <Avatar name={r.name} id={r.id} size={22} square mxc={r.avatarUrl} />
                <span>
                  <b>
                    {r.name}
                    {r.copiedFrom && <i className="pill">copy</i>}
                  </b>
                  <small className="mono">{r.id}</small>
                </span>
                {r.id === room?.id && <Icon name="check" size={14} className="end" />}
              </button>
            ))}
          </div>
          <div className="dd-sep" />
          <button
            type="button"
            className="dd-row add"
            onClick={() => {
              picker.close();
              dispatch({ type: "mock/addRoom" });
            }}
          >
            <Icon name="plus" size={16} />
            <span>
              <b>Add room</b>
            </span>
          </button>
        </div>
      )}
      {room && (
        <>
          <button ref={actions.triggerRef} type="button" className={`ibtn ${actions.open ? "on" : ""}`} title="Room actions" aria-label="Room actions" aria-haspopup="menu" aria-expanded={actions.open} onClick={actions.toggle}>
            <Icon name="dots" size={16} />
          </button>
          {actions.open && (
            <div ref={actions.popupRef} className="dropdown" role="menu" aria-label="Room actions" onKeyDown={actions.onKeyDown}>
              {/* TODO-FINDING devbackend-destructive-confirm - "clear room" and "remove room" lose state; appDesign.md wants such actions confirmed. The view sends the intents directly and leaves the confirmation to the controller. */}
              <button
                type="button"
                className="dd-row"
                role="menuitem"
                onClick={() => {
                  actions.close();
                  dispatch({ type: "mock/clearRoom", roomId: room.id });
                }}
              >
                <Icon name="refresh" size={16} />
                <span>
                  <b>Clear room</b>
                  <small>Drops all events of this room</small>
                </span>
              </button>
              <button
                type="button"
                className="dd-row danger"
                role="menuitem"
                onClick={() => {
                  actions.close();
                  dispatch({ type: "mock/removeRoom", roomId: room.id });
                }}
              >
                <Icon name="trash" size={16} />
                <span>
                  <b>Remove room</b>
                  <small>Deletes the mocked room</small>
                </span>
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
