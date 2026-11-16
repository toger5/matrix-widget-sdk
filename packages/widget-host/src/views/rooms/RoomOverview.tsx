import { useState } from "react";

import { activeAccount, widgetInstanceId, widgetTab, type MainViewModel, type PanelId, type RoomId } from "../../appViewModel";
import { useDispatch, useViewEnv } from "../env";
import { roomOf, roomWidgets, type RoomWidget } from "../helpers";
import { Avatar, Button, Icon, initials } from "../ui/atoms";
import { hostOf } from "./tabInfo";

export interface RoomOverviewProps {
  main: MainViewModel;
  panelId: PanelId;
  roomId: RoomId;
  /** `settings.devTools`: shows the "Copy to DevBackend" card. */
  devTools: boolean;
  /** The panel has a Timeline tab: the header offers "Show timeline" instead of "Open timeline". */
  timelineOpen?: boolean;
}

const DEFAULT_LAST_EVENTS = 50;

/**
 * What the room name tab shows, and where a room opens. leaves overview/plain, overview/devtools,
 * roomview2/same. The header opens the RoomTimeline (or shows its tab). The widget list comes first: a widget opens as a new tab; one that is already
 * open (a widget runs once per account) is grayed out and offers "jump to tab", and "move widget
 * here" when its tab is in another panel. Then encryption, members and, with dev tools enabled,
 * the dev card. Topic, members and encryption come from `useViewEnv().useRoomDetails(roomId)`.
 */
export function RoomOverview({ main, panelId, roomId, devTools, timelineOpen = false }: RoomOverviewProps) {
  const dispatch = useDispatch();
  const details = useViewEnv().useRoomDetails(roomId);
  const [lastEvents, setLastEvents] = useState(String(DEFAULT_LAST_EVENTS));

  const room = roomOf(main, roomId);
  if (!room) return <RoomUnavailable main={main} roomId={roomId} />;
  const name = room.name;
  const widgets = roomWidgets(room);
  const info = details.status === "ready" ? details.value : undefined;
  const members = info?.members ?? [];
  const memberCount = info?.memberCount ?? room.memberCount;
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
          <Avatar name={name} id={roomId} size={72} square mxc={room.avatarUrl} />
          <div>
            <h1>{name}</h1>
            <span className="mono muted">{roomId}</span>
            {info?.topic && <p>{info.topic}</p>}
            {details.status === "loading" && loading("the description")}
            {failed("description")}
          </div>
          {timelineOpen ? (
            <Button icon="goToTab" title="Show the timeline tab" onClick={() => dispatch({ type: "tab/openTimeline", panelId })}>
              Show timeline
            </Button>
          ) : (
            <Button icon="message" title="Open the timeline of this room in a new tab" onClick={() => dispatch({ type: "tab/openTimeline", panelId })}>
              Open timeline
            </Button>
          )}
        </header>
        <div className="ov-grid">
          <section className="card span">
            <h3>
              <Icon name="grid" size={15} />
              Widgets {room.widgetEvents !== undefined && <em>{widgets.length}</em>}
            </h3>
            <div className="ov-widgets">
              {widgets.map((w) => (
                <WidgetRow key={w.key} main={main} panelId={panelId} roomId={roomId} widget={w} />
              ))}
              {room.widgetEvents === undefined && loading("the widgets")}
              {room.widgetEvents !== undefined && widgets.length === 0 && <p className="muted">This room has no widgets.</p>}
            </div>
          </section>
          <section className="card span">
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

/** One widget of the list. The accessible names are the ones of the tests (and of the mockup). */
function WidgetRow({ main, panelId, roomId, widget: w }: { main: MainViewModel; panelId: PanelId; roomId: RoomId; widget: RoomWidget }) {
  const dispatch = useDispatch();
  const widgetId = widgetInstanceId(roomId, w.key);
  const avatar = <Avatar name={w.name} id={w.key} size={26} square label={initials(w.name)} />;
  if (w.problem) {
    // Not `disabled`: the row stays focusable, so the problem can be read with the keyboard.
    return (
      <button type="button" className="row sm" aria-disabled="true" aria-label={`${w.name} cannot be opened: ${w.problem}`} title={w.problem} data-widget-key={w.key}>
        {avatar}
        <span className="row-main">
          <b>{w.name}</b>
          <small>{w.problem}</small>
        </span>
      </button>
    );
  }
  if (!main.widgets[widgetId]) {
    return (
      <button type="button" className="row sm" aria-label={`Open ${w.name}`} title={`Open ${w.name} in a new tab`} data-widget-key={w.key} onClick={() => dispatch({ type: "tab/openWidget", panelId, widgetKey: w.key })}>
        {avatar}
        <span className="row-main">
          <b>{w.name}</b>
          <small>{hostOf(w.event.content.url)}</small>
        </span>
        <Icon name="arrowUpRight" size={14} className="end" />
      </button>
    );
  }
  const tab = widgetTab(main, widgetId);
  const elsewhere = tab?.panelId !== panelId;
  // TODO-FINDING tile-widget-without-tab - a running widget can have no tab at all (always on screen, its room panel was closed). The mockups only draw "open in this panel" and "open in the other panel". For now it is treated like "another panel": "jump to tab" opens its panel again, "move widget here" gives it a tab here.
  const where = !tab ? "running without a tab" : elsewhere ? "open in the other panel" : "open in this panel";
  return (
    <div className="row sm opened" data-widget-key={w.key} data-widget-id={widgetId}>
      {avatar}
      <span className="row-main">
        <b>{w.name}</b>
        <small>{where}</small>
      </span>
      <span className="row-acts">
        <button type="button" className="btn sm primary" aria-label={`Jump to the tab of ${w.name}`} onClick={() => dispatch({ type: "widget/jumpToTab", widgetId })}>
          <Icon name="goToTab" size={14} />
          <span>Jump to tab</span>
        </button>
        {elsewhere && (
          <button
            type="button"
            className="btn sm"
            title="Closes its tab in the other room panel and opens it here. The widget keeps running."
            aria-label={`Move ${w.name} here`}
            onClick={() => dispatch({ type: "tab/moveWidgetHere", panelId, widgetId })}
          >
            <Icon name="arrowLeft" size={14} />
            <span>Move widget here</span>
          </button>
        )}
      </span>
    </div>
  );
}

/** The body for a room that is not in `data.rooms`: the room list is loading or failed, or the room was left. */
function RoomUnavailable({ main, roomId }: { main: MainViewModel; roomId: RoomId }) {
  const rooms = main.data.rooms;
  // TODO-FINDING room-view-without-room - a room panel whose room is not in `data.rooms` (still loading, failed, or the room was left) is not drawn. For now: the loading / error / "not available" state here, and the room id as the name of the room name tab.
  return (
    <div className="ov" data-testid="room-overview" data-room-id={roomId}>
      <div className="ov-in">
        {rooms.status === "error" ? (
          <div className="empty" role="alert">
            <Icon name="alert" size={28} className="danger" />
            <b>The room could not be loaded</b>
            <p>{rooms.error}</p>
          </div>
        ) : rooms.status === "loading" ? (
          <div className="empty" role="status">
            <span className="spinner" aria-hidden="true" />
            <b>Loading the room…</b>
          </div>
        ) : (
          <div className="empty">
            <Icon name="alert" size={28} />
            <b>This room is not available</b>
            <p>It is not one of the rooms of this account anymore.</p>
          </div>
        )}
      </div>
    </div>
  );
}
