/**
 * The room box of the Dev tools: the room
 * dropdown in the header and the State and Timeline sections of the shown room. Shared by the
 * DevBackendView (`mode` "devBackend": mocked rooms, any sender, "Add room", "Room actions") and the
 * Dev tools of a Matrix account (`mode` "account": the rooms of the room panels, sent as the
 * account). The state and the timeline are read the same way in both modes:
 * `useViewEnv().useRoomTimeline` and `useRoomState`.
 */
import type { CSSProperties } from "react";

import { roomStateVersion, type MockedRoomData, type MockedStateEvent, type RoomId, type RoomToolsSection, type RoomToolsViewModel, type ScheduledEvent } from "../../appViewModel";
import type { RawEvent } from "../../session";
import { useDispatch, useViewEnv } from "../env";
import { Avatar, Button, Icon, IconButton } from "../ui/atoms";
import { Acc, usePopup } from "./parts";
import { StateSection } from "./StateSection";
import { TimelineSection } from "./TimelineSection";

export type RoomBoxMode = "devBackend" | "account";

/** A room of the dropdown. */
export type RoomToolsRoom = MockedRoomData["rooms"][number];

export interface RoomBoxProps {
  mode: RoomBoxMode;
  /** The rooms of the dropdown, in its order. */
  rooms: RoomToolsRoom[];
  /** The shown room, one of `rooms`; none: the empty state (stories `sidepanel-devbackendview--no-rooms`, `sidepanel-roomtoolsview--no-room-open`). */
  roomId?: RoomId;
  roomTools: RoomToolsViewModel;
  /** The DevBackend's user (the default sender) or the account (the only sender). */
  userId?: string;
  /** The delayed events of the shown room that "Scheduled" lists. */
  scheduled: ScheduledEvent[];
}

const plural = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;

/** A state event of the room as the forms of the State section take it. */
const asStateEvent = (event: RawEvent): MockedStateEvent => ({ type: event.type, stateKey: String(event.state_key), content: event.content });

export function RoomBox({ mode, rooms, roomId, roomTools, userId, scheduled }: RoomBoxProps) {
  const dispatch = useDispatch();
  const room = rooms.find((r) => r.id === roomId);
  return (
    <section className="sidebox devb" data-testid={mode === "devBackend" ? "devbackend-view" : "room-tools-view"} data-room-id={room?.id}>
      <header className="side-head">
        <RoomHeader mode={mode} rooms={rooms} room={room} />
        {/* TODO-FINDING devbackend-header-buttons - the designed header is only the room dropdown. "Close panel" (as in the other SidePanel views) and, in the DevBackend, the "Room actions" menu (clear room, remove room) were added next to it; neither is drawn. */}
        <IconButton icon="x" title="Close panel" onClick={() => dispatch({ type: "sidePanel/close" })} />
      </header>
      <div className="side-body">
        {room ? (
          <RoomSections key={room.id} mode={mode} roomId={room.id} roomTools={roomTools} userId={userId} scheduled={scheduled} />
        ) : mode === "account" ? (
          <div className="empty">
            <Icon name="grid" size={28} />
            <b>No room open</b>
            <p>Open a room in a room panel to explore its state and send events to it.</p>
            <Button kind="primary" icon="plus" onClick={() => dispatch({ type: "panel/new" })}>
              New room panel
            </Button>
          </div>
        ) : rooms.length ? (
          <div className="empty">
            <Icon name="cone" size={28} />
            <b>No room selected</b>
            <p>Pick a mocked room in the dropdown above.</p>
          </div>
        ) : (
          <div className="empty">
            <Icon name="cone" size={28} />
            <b>No mocked rooms yet</b>
            <p>Create an empty room, or copy a real one from its room overview (DevBackend › Copy to DevBackend).</p>
            <Button kind="primary" icon="plus" onClick={() => dispatch({ type: "mock/addRoom" })}>
              Create a room
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * The State and Timeline sections of one room, read through the hooks of the `ViewEnv`. Stories
 * `sidepanel-devbackendview--state`, `sidepanel-devbackendview-state--*`,
 * `sidepanel-devbackendview--timeline*`, `sidepanel-roomtoolsview--state`, `--timeline`,
 * `--loading-failed`.
 */
function RoomSections({ mode, roomId, roomTools, userId, scheduled }: { mode: RoomBoxMode; roomId: RoomId; roomTools: RoomToolsViewModel; userId?: string; scheduled: ScheduledEvent[] }) {
  const dispatch = useDispatch();
  const env = useViewEnv();
  const { timeline, retry: retryTimeline } = env.useRoomTimeline(roomId);
  const { state, retry: retryState } = env.useRoomState(roomId, roomStateVersion(timeline));
  const isOpen = (section: RoomToolsSection) => roomTools.openSections.includes(section);
  const toggle = (section: RoomToolsSection) => () => dispatch({ type: "roomTools/toggleSection", section });

  const stateEvents = state.status === "ready" ? state.value.filter((e) => typeof e.state_key === "string").map(asStateEvent) : [];
  const members = stateEvents.filter((e) => e.type === "m.room.member").map((e) => e.stateKey);
  const stateTypes = new Set(stateEvents.map((e) => e.type)).size;
  const events = timeline.status === "ready" ? timeline.value.events : [];

  return (
    <>
      {mode === "account" && (
        <p className="rt-hint">
          <Icon name="info" size={13} />
          <span>
            Sent to the room as <b className="mono">{userId}</b>. Everyone in it sees it.
          </span>
        </p>
      )}
      <Acc id="state" title="State" open={isOpen("state")} count={state.status === "ready" ? plural(stateTypes, "type") : undefined} onToggle={toggle("state")}>
        {state.status === "ready" ? (
          <StateSection mode={mode} roomId={roomId} state={stateEvents} stateForm={roomTools.stateForm} userId={userId} />
        ) : state.status === "loading" ? (
          <Loading text="Reading the room state…" />
        ) : (
          <Failed title="The room state could not be read" error={state.error} retry={retryState} />
        )}
      </Acc>
      <Acc id="timeline" title="Timeline" open={isOpen("timeline")} count={timeline.status === "ready" ? plural(events.length, "event") : undefined} onToggle={toggle("timeline")}>
        {timeline.status === "ready" ? (
          <TimelineSection
            mode={mode}
            roomId={roomId}
            sendForm={roomTools.sendForm}
            events={events}
            atStart={timeline.value.atStart}
            loadingOlder={timeline.value.loadingOlder}
            scheduled={scheduled}
            userId={userId}
            members={members}
          />
        ) : timeline.status === "loading" ? (
          <Loading text="Loading the timeline…" />
        ) : (
          <Failed title="The timeline could not be loaded" error={timeline.error} retry={retryTimeline} />
        )}
      </Acc>
    </>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <div className="empty" role="status">
      <span className="spinner" aria-hidden="true" />
      <b>{text}</b>
    </div>
  );
}

function Failed({ title, error, retry }: { title: string; error: string; retry: () => void }) {
  return (
    <div className="empty" role="alert">
      <Icon name="alert" size={28} className="danger" />
      <b>{title}</b>
      <p>{error}</p>
      <Button kind="primary" icon="refresh" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}

/** The room name + id with the room dropdown and, in the DevBackend, the menu with the actions on the room. stories `sidepanel-devbackendview--room-dropdown`, `sidepanel-roomtoolsview--room-dropdown` */
function RoomHeader({ mode, rooms, room }: { mode: RoomBoxMode; rooms: RoomToolsRoom[]; room?: RoomToolsRoom }) {
  const dispatch = useDispatch();
  const picker = usePopup();
  const actions = usePopup();
  const dev = mode === "devBackend";

  if (!rooms.length) {
    return (
      <div className="room-pick none">
        <span className="av sq ghost" style={{ "--s": "28px" } as CSSProperties} aria-hidden="true">
          <Icon name="hash" size={14} />
        </span>
        <div className="side-title">
          <b>{dev ? "No mocked room" : "No room open"}</b>
          <small>{dev ? "DevBackend" : "Dev tools"}</small>
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
          <div role="listbox" aria-label={dev ? "Mocked rooms" : "Open rooms"}>
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
                  if (r.id !== room?.id) dispatch({ type: "roomTools/selectRoom", roomId: r.id });
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
          {dev && (
            <>
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
            </>
          )}
        </div>
      )}
      {dev && room && (
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
