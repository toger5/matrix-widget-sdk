import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

import { activeAccount, widgetInstanceId, widgetTab, type MainViewModel, type PanelId, type RoomId } from "../../appViewModel";
import { localWidgetKey, type StateEvent } from "../../widgetStateEvent";
import { useDispatch, useViewEnv } from "../env";
import { localWidgetsOf, roomOf, roomWidgets, type RoomWidget } from "../helpers";
import { Avatar, Button, Icon, IconButton, initials } from "../ui/atoms";
import { AddWidgetForm, type AddWidgetDraft } from "./AddWidgetForm";
import { hostOf } from "./tabInfo";

export interface RoomOverviewProps {
  main: MainViewModel;
  panelId: PanelId;
  roomId: RoomId;
  /** `settings.devTools`: "Add widget", editing local widgets, and "Open room dev tools". */
  devTools: boolean;
  /** `settings.devBackend`: the DevBackend card ("Copy to DevBackend"). */
  devBackend: boolean;
  /** The panel has a Timeline tab: the header offers "Show timeline" instead of "Open timeline". */
  timelineOpen?: boolean;
  /** The panel has a room dev tools tab: "Show room dev tools" instead of "Open room dev tools" (with `devTools`). */
  roomToolsOpen?: boolean;
  /** Stories: the "Add widget" form is open, with this draft. */
  initialAddWidget?: Partial<AddWidgetDraft>;
}

const DEFAULT_LAST_EVENTS = 50;

/**
 * What the room name tab shows, and where a room opens. Stories `rooms-roomoverview--*`,
 * `app-appshell--same-room-twice`. The header opens the RoomTimeline and, with dev tools, the room
 * dev tools (or shows their tab). The
 * widget list comes first: the room's widgets, then the local ones. A widget opens as a new tab;
 * one that is already open (a widget runs once per account) is grayed out and offers "jump to
 * tab", and "move widget here" when its tab is in another panel. With dev tools enabled "Add
 * widget" opens the `AddWidgetForm` at the top of the list (view state). Then encryption, members
 * and, with the DevBackend enabled, the DevBackend card. Topic, members and encryption come from
 * `useViewEnv().useRoomDetails(roomId)`.
 */
export function RoomOverview({ main, panelId, roomId, devTools, devBackend, timelineOpen = false, roomToolsOpen = false, initialAddWidget }: RoomOverviewProps) {
  const dispatch = useDispatch();
  const { useRoomDetails, widgetEvents } = useViewEnv();
  const details = useRoomDetails(roomId);
  const [lastEvents, setLastEvents] = useState(String(DEFAULT_LAST_EVENTS));
  /** The open "Add widget" form; `edit`: it edits this local widget. */
  const [adding, setAdding] = useState<{ edit?: StateEvent } | null>(initialAddWidget ? {} : null);

  const room = roomOf(main, roomId);
  if (!room) return <RoomUnavailable main={main} roomId={roomId} />;
  const name = room.name;
  const local = localWidgetsOf(main, roomId);
  // The local widget being edited was removed (its remove button, another panel): its form closes, so "Save" cannot add it again.
  const editing = adding?.edit;
  if (editing && !local.some((e) => localWidgetKey(e) === localWidgetKey(editing))) setAdding(null);
  const widgets = roomWidgets(widgetEvents, room, local);
  const write = main.widgetWrite?.roomId === roomId ? main.widgetWrite : undefined;
  // A refusal belongs to the form that sent it: opening or closing a form forgets it.
  const openForm = (edit?: StateEvent) => {
    if (write) dispatch({ type: "room/dismissWidgetWrite" });
    setAdding({ edit });
  };
  const closeForm = () => {
    if (write) dispatch({ type: "room/dismissWidgetWrite" });
    setAdding(null);
  };
  const info = details.status === "ready" ? details.value : undefined;
  const members = info?.members ?? [];
  const memberCount = info?.memberCount ?? room.memberCount;
  const account = activeAccount(main);
  // A DevBackend room is already in the DevBackend.
  const copyCard = devBackend && account?.kind !== "devBackend";
  const lastEventsNumber = lastEvents.trim() === "" ? NaN : Math.max(0, Math.floor(Number(lastEvents)));

  const widgetsTitle = (
    <h3>
      <Icon name="grid" size={15} />
      Widgets {room.widgetEvents !== undefined && <em>{widgets.length}</em>}
    </h3>
  );
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
          <div className="ov-acts">
            {timelineOpen ? (
              <Button icon="goToTab" title="Show the timeline tab" onClick={() => dispatch({ type: "tab/openTimeline", panelId })}>
                Show timeline
              </Button>
            ) : (
              <Button icon="message" title="Open the timeline of this room in a new tab" onClick={() => dispatch({ type: "tab/openTimeline", panelId })}>
                Open timeline
              </Button>
            )}
            {devTools &&
              (roomToolsOpen ? (
                <Button icon="goToTab" title="Show the room dev tools tab" onClick={() => dispatch({ type: "tab/openRoomTools", panelId })}>
                  Show room dev tools
                </Button>
              ) : (
                <Button icon="cone" title="Open the dev tools of this room in a new tab" onClick={() => dispatch({ type: "tab/openRoomTools", panelId })}>
                  Open room dev tools
                </Button>
              ))}
          </div>
        </header>
        <div className="ov-grid">
          <section className="card span">
            {devTools ? (
              <div className="card-h">
                {widgetsTitle}
                {!adding && (
                  <Button sm icon="plus" title="Add a widget to this room" onClick={() => openForm()}>
                    Add widget
                  </Button>
                )}
              </div>
            ) : (
              widgetsTitle
            )}
            <div className="ov-widgets">
              {devTools && adding && (
                <AddWidgetForm
                  key={adding.edit ? localWidgetKey(adding.edit) : "new"}
                  roomId={roomId}
                  roomEvents={room.widgetEvents ?? []}
                  localEvents={local}
                  edit={adding.edit}
                  write={adding.edit ? undefined : write}
                  userId={account?.userId}
                  initial={initialAddWidget}
                  onClose={closeForm}
                />
              )}
              {widgets.map((w) => (
                <WidgetRow key={w.key} main={main} panelId={panelId} roomId={roomId} widget={w} devTools={devTools} onEdit={() => openForm(w.event)} />
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
            {/* TODO-FINDING overview-encryption-unknown - `RoomDetails.encrypted` is optional and the design only has "encrypted". For now: "Not encrypted" for `false`, "Unknown" when the session does not say. */}
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
            {/* TODO-FINDING overview-show-all-members - the design has a "Show all 12 members" link, but `RoomDetails.members` is only "the first members" and there is no intent or data to get the rest. For now a plain text line says how many are shown. */}
            {info && memberCount !== undefined && memberCount > members.length && (
              <span className="muted ov-more">{members.length ? `The first ${members.length} of ${memberCount} members are shown.` : `${memberCount} members.`}</span>
            )}
            {info && memberCount === undefined && members.length === 0 && <p className="muted">The session does not report the members of this room.</p>}
          </section>
          {copyCard && (
            <section className="card span devcard">
              <h3>
                <Icon name="cone" size={15} />
                DevBackend
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

/** The attributes of the part of a widget row that opens the widget. */
type OpenProps = ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * One widget of the list. The accessible names are the ones of the tests (and of the stories). A
 * local widget is marked "Local" and has its own buttons (edit with dev tools, remove), so its row
 * is not one button: its `row-open` part opens it.
 */
function WidgetRow({ main, panelId, roomId, widget: w, devTools, onEdit }: { main: MainViewModel; panelId: PanelId; roomId: RoomId; widget: RoomWidget; devTools: boolean; onEdit: () => void }) {
  const dispatch = useDispatch();
  const widgetId = widgetInstanceId(roomId, w.key);
  const avatar = <Avatar name={w.name} id={w.key} size={26} square label={initials(w.name)} />;
  const mark = w.local && <span className="pill">Local</span>;
  const localActs = w.local && (
    <>
      {devTools && <IconButton icon="edit" title={`Edit ${w.name}`} className="xs" onClick={onEdit} />}
      <IconButton icon="trash" title={`Remove ${w.name}`} className="xs" onClick={() => dispatch({ type: "room/removeLocalWidget", roomId, widgetKey: w.key })} />
    </>
  );
  /** A local widget's row: the open part (`inner`, the attributes of the button) and its buttons. */
  const localRow = (open: OpenProps, inner: ReactNode) => (
    <div className="row sm local" data-widget-key={w.key}>
      <button type="button" className="row-open" {...open}>
        {inner}
      </button>
      <span className="row-acts">{localActs}</span>
    </div>
  );
  if (w.problem) {
    // Not `disabled`: the row stays focusable, so the problem can be read with the keyboard.
    const open: OpenProps = { "aria-disabled": true, "aria-label": `${w.name} cannot be opened: ${w.problem}`, title: w.problem };
    const inner = (
      <>
        {avatar}
        <span className="row-main">
          <b>{w.name}</b>
          <small>
            {mark}
            {w.problem}
          </small>
        </span>
      </>
    );
    return w.local ? (
      localRow(open, inner)
    ) : (
      <button type="button" className="row sm" {...open} data-widget-key={w.key}>
        {inner}
      </button>
    );
  }
  if (!main.widgets[widgetId]) {
    const open: OpenProps = { "aria-label": `Open ${w.name}`, title: `Open ${w.name} in a new tab`, onClick: () => dispatch({ type: "tab/openWidget", panelId, widgetKey: w.key }) };
    const inner = (
      <>
        {avatar}
        <span className="row-main">
          <b>{w.name}</b>
          <small>
            {mark}
            {hostOf(w.event.content.url)}
          </small>
        </span>
        <Icon name="arrowUpRight" size={14} className="end" />
      </>
    );
    return w.local ? (
      localRow(open, inner)
    ) : (
      <button type="button" className="row sm" {...open} data-widget-key={w.key}>
        {inner}
      </button>
    );
  }
  const tab = widgetTab(main, widgetId);
  const elsewhere = tab?.panelId !== panelId;
  // TODO-FINDING tile-widget-without-tab - a running widget can have no tab at all (always on screen, its room panel was closed). The design only has "open in this panel" and "open in the other panel". For now it is treated like "another panel": "jump to tab" opens its panel again, "move widget here" gives it a tab here.
  const where = !tab ? "running without a tab" : elsewhere ? "open in the other panel" : "open in this panel";
  return (
    <div className={`row sm opened ${w.local ? "local" : ""}`} data-widget-key={w.key} data-widget-id={widgetId}>
      {avatar}
      <span className="row-main">
        <b>{w.name}</b>
        <small>
          {mark}
          {where}
        </small>
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
        {localActs}
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
