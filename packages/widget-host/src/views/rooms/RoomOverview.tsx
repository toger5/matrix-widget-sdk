import { useState } from "react";

import { activeAccount, type MainViewModel, type PanelId, type RoomId } from "../../appViewModel";
import { useDispatch, useViewEnv } from "../env";
import { roomOf, roomWidgets } from "../helpers";
import { Avatar, Button, Icon, initials } from "../ui/atoms";
import { hostOf } from "./tabInfo";

export interface RoomOverviewProps {
  main: MainViewModel;
  panelId: PanelId;
  roomId: RoomId;
  /** `settings.devTools`: shows the "Copy to DevBackend" card. */
  devTools: boolean;
}

const DEFAULT_LAST_EVENTS = 50;

/** The RoomOverviewTab. leaves overview/plain, overview/devtools. Topic, members and encryption come from `useViewEnv().useRoomDetails(roomId)`. */
export function RoomOverview({ main, panelId, roomId, devTools }: RoomOverviewProps) {
  const dispatch = useDispatch();
  const details = useViewEnv().useRoomDetails(roomId);
  const [lastEvents, setLastEvents] = useState(String(DEFAULT_LAST_EVENTS));

  const room = roomOf(main, roomId);
  const name = room?.name ?? roomId;
  const widgets = roomWidgets(room);
  const info = details.status === "ready" ? details.value : undefined;
  const members = info?.members ?? [];
  const memberCount = info?.memberCount ?? room?.memberCount;
  const account = activeAccount(main);
  // A DevBackend room is already in the DevBackend.
  const copyCard = devTools && account?.kind !== "devBackend";
  const lastEventsNumber = lastEvents.trim() === "" ? NaN : Math.max(0, Math.floor(Number(lastEvents)));

  const loading = (what: string) => (
    <p className="muted" role="status">
      Loading {what}…
    </p>
  );
  const failed = (what: string) =>
    details.status === "error" && (
      <p className="danger" role="alert">
        The {what} could not be loaded: {details.error}
      </p>
    );

  return (
    <div className="ov" data-testid="room-overview" data-room-id={roomId}>
      <div className="ov-in">
        <header className="ov-hero">
          <Avatar name={name} id={roomId} size={72} square mxc={room?.avatarUrl} />
          <div>
            <h1>{name}</h1>
            <span className="mono muted">{roomId}</span>
            {info?.topic && <p>{info.topic}</p>}
            {details.status === "loading" && loading("the description")}
            {failed("description")}
          </div>
        </header>
        <div className="ov-grid">
          <section className="card">
            <h3>
              <Icon name="shield" size={15} />
              Encryption
            </h3>
            {details.status === "loading" && loading("the encryption status")}
            {failed("encryption status")}
            {info?.encrypted === true && (
              <>
                <p className="ok-text">
                  <b>End-to-end encrypted</b>
                </p>
                <p className="muted">
                  Messages and widget events in this room are encrypted.{account?.verified === true ? " This device is verified." : account?.verified === false ? " This device is not verified yet." : ""}
                </p>
              </>
            )}
            {info?.encrypted === false && (
              <>
                <p>
                  <b>Not encrypted</b>
                </p>
                <p className="muted">Messages and widget events in this room are readable by the homeserver.</p>
              </>
            )}
            {/* TODO-FINDING overview-encryption-unknown - `RoomDetails.encrypted` is optional and the mockup only draws "encrypted". For now: "Not encrypted" for `false`, "Unknown" when the session does not say. */}
            {info && info.encrypted === undefined && <p className="muted">Unknown: the session does not report the encryption of this room.</p>}
          </section>
          <section className="card">
            <h3>
              <Icon name="grid" size={15} />
              Widgets <em>{widgets.length}</em>
            </h3>
            <div className="ov-widgets">
              {widgets.map((w) => (
                <button
                  key={w.key}
                  type="button"
                  className="row sm"
                  title={w.problem ?? `Open ${w.name} in a new tab`}
                  aria-disabled={w.problem ? true : undefined}
                  data-widget-key={w.key}
                  onClick={() => !w.problem && dispatch({ type: "tab/openWidget", panelId, widgetKey: w.key })}
                >
                  <Avatar name={w.name} id={w.key} size={26} square label={initials(w.name)} />
                  <span className="row-main">
                    <b>{w.name}</b>
                    <small>{w.problem ?? hostOf(w.event.content.url)}</small>
                  </span>
                  {!w.problem && <Icon name="arrowUpRight" size={14} className="end" />}
                </button>
              ))}
              {room && room.widgetEvents === undefined && loading("the widgets")}
              {room?.widgetEvents !== undefined && widgets.length === 0 && <p className="muted">This room has no widgets.</p>}
            </div>
          </section>
          <section className="card span">
            <h3>
              <Icon name="users" size={15} />
              Members {memberCount !== undefined && <em>{memberCount}</em>}
            </h3>
            {details.status === "loading" && loading("the members")}
            {failed("members")}
            {info && (
              <div className="ov-members">
                {members.map((m) => (
                  <div key={m.userId} className="member">
                    <Avatar name={m.displayName ?? m.userId.replace(/^@/, "")} id={m.userId} size={30} mxc={m.avatarUrl} />
                    <span className="row-main">
                      <b>{m.displayName ?? m.userId}</b>
                      <small>{m.userId}</small>
                    </span>
                    {m.role && <span className="pill">{m.role}</span>}
                  </div>
                ))}
              </div>
            )}
            {/* TODO-FINDING overview-show-all-members - the mockup has a "Show all 12 members" link, but `RoomDetails.members` is only "the first members" and there is no intent or data to get the rest. For now a plain text line says how many are shown. */}
            {info && memberCount !== undefined && memberCount > members.length && (
              <span className="muted ov-more">{members.length ? `The first ${members.length} of ${memberCount} members are shown.` : `${memberCount} members.`}</span>
            )}
            {info && memberCount === undefined && members.length === 0 && <p className="muted">The session does not report the members of this room.</p>}
          </section>
          {copyCard && (
            <section className="card span devcard">
              <h3>
                <Icon name="cone" size={15} />
                Dev tools
              </h3>
              <div className="inline-row">
                <div>
                  <b>Copy to DevBackend</b>
                  <p className="muted">Copies the room state and the last events into a mocked room, to experiment with it offline.</p>
                </div>
                <span className="sp" />
                <label className="field inline">
                  <span className="field-l">Last events</span>
                  <input
                    className="input mono narrow"
                    type="number"
                    min={0}
                    step={10}
                    value={lastEvents}
                    onChange={(e) => setLastEvents(e.target.value)}
                    onBlur={() => setLastEvents(String(Number.isFinite(lastEventsNumber) ? lastEventsNumber : DEFAULT_LAST_EVENTS))}
                  />
                </label>
                <Button icon="copy" className="dev" disabled={!Number.isFinite(lastEventsNumber)} onClick={() => dispatch({ type: "room/copyToDevBackend", roomId, lastEvents: lastEventsNumber })}>
                  Copy to DevBackend
                </Button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
