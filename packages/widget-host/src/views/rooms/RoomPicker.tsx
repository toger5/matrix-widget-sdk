import { useId, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";

import { RECENT_TILES, widgetInstanceId, widgetTab, type MainViewModel, type PanelId, type RoomId, type WidgetKey } from "../../appViewModel";
import type { RoomSummary } from "../../session";
import type { StateEvent } from "../../widgetStateEvent";
import { useDispatch, useViewEnv } from "../env";
import { localWidgetsOf, readyRooms, roomOf, roomWidgets } from "../helpers";
import { Avatar, Button, Icon, initials } from "../ui/atoms";

export interface RoomPickerProps {
  main: MainViewModel;
  /** The room panel whose body the picker is. Without it, it is the Room list of the SidePanel. */
  panelId?: PanelId;
}

/** The name with the part that matches the filter marked. */
function marked(name: string, filter: string): ReactNode {
  const at = filter ? name.toLowerCase().indexOf(filter.toLowerCase()) : -1;
  if (at < 0) return name;
  return (
    <>
      {name.slice(0, at)}
      <mark>{name.slice(at, at + filter.length)}</mark>
      {name.slice(at + filter.length)}
    </>
  );
}

/** One group of the picker: a heading (`.side-h`) and what it labels. */
function Group({ id, title, count, className = "", children, groupRef }: { id: string; title: string; count?: number; className?: string; children: ReactNode; groupRef?: Ref<HTMLElement> }) {
  return (
    <section ref={groupRef} className={`pick-sec ${className}`} aria-labelledby={id}>
      <h2 className="side-h" id={id}>
        {title}
        {count !== undefined && (
          <>
            {" "}
            <em className="count">{count}</em>
          </>
        )}
      </h2>
      {children}
    </section>
  );
}

/** The numbers of widgets (with the local ones, `local`) and members of a room: icons, with the words for screen readers. */
function RoomCounts({ room, local }: { room: RoomSummary; local: StateEvent[] }) {
  const widgets = roomWidgets(room, local).length;
  return (
    <>
      <Icon name="grid" size={12} />
      {widgets}
      <span className="vh">{widgets === 1 ? " widget" : " widgets"}</span>
      {room.memberCount !== undefined && (
        <>
          {" "}
          <Icon name="users" size={12} />
          {room.memberCount}
          <span className="vh">{room.memberCount === 1 ? " member" : " members"}</span>
        </>
      )}
    </>
  );
}

/** A tile of "Recent widgets" or "Recent rooms": the whole tile is the button. */
function Tile({ label, avatar, name, sub, onClick, ...data }: { label: string; avatar: ReactNode; name: string; sub: ReactNode; onClick: () => void; "data-room-id": RoomId; "data-widget-key"?: WidgetKey }) {
  return (
    <li>
      <button type="button" className="ptile" title={label} aria-label={label} onClick={onClick} {...data}>
        {avatar}
        <span className="ptile-t">
          <b>{name}</b>
          <small>{sub}</small>
        </span>
      </button>
    </li>
  );
}

/**
 * Choosing a room, no title: "Recent widgets" and "Recent rooms" (tiles; a group without entries
 * is left out), then "All rooms" with the search field and the list. The body of a room panel
 * without a room, and the Room list of the SidePanel. leaves panel/*, sidepanel/rooms
 */
export function RoomPicker({ main, panelId }: RoomPickerProps) {
  const dispatch = useDispatch();
  const { narrow } = useViewEnv();
  const ids = useId();
  const [filter, setFilter] = useState("");
  // Once the search field had the focus, the "All rooms" group is at least as high as the scroll
  // area (CSS `.pick-sec.searching`), so it can scroll to the top; it stays so, else a press on a
  // row that takes the focus from the field would move the row away under the pointer. Without
  // recents nothing is above the group: it is at the top already and nothing scrolls.
  const [searched, setSearched] = useState(false);
  const [scrollRequest, setScrollRequest] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const allRooms = useRef<HTMLElement>(null);

  // The search field got the focus or a query: its group goes to the top of the scroll area, the matches right under it.
  useLayoutEffect(() => {
    const area = scroller.current;
    const group = allRooms.current;
    if (!scrollRequest || !area || !group?.previousElementSibling) return;
    // `scroll-margin-top` of the group: the space it keeps from the top (CSS `.pick-sec.searching`).
    const margin = parseFloat(getComputedStyle(group).scrollMarginTop) || 0;
    area.scrollTop += group.getBoundingClientRect().top - area.getBoundingClientRect().top - margin;
  }, [scrollRequest]);

  const open = (roomId: RoomId, widgetKey?: WidgetKey) => {
    if (panelId !== undefined) return dispatch({ type: "panel/openRoom", panelId, roomId, widgetKey });
    dispatch({ type: "room/open", roomId, widgetKey });
    // In a narrow window the SidePanel lies over the room panel the pick opened in.
    if (narrow) dispatch({ type: "sidePanel/close" });
  };

  const rooms = main.data.rooms;
  const wrap = (inner: ReactNode) => (
    <div ref={scroller} className="picker" data-testid="room-picker">
      <div className="picker-in">{inner}</div>
    </div>
  );

  if (rooms.status === "loading") {
    return wrap(
      <div className="pick-sec" role="status" aria-label="Loading your rooms">
        <ul className="ptiles">
          {Array.from({ length: RECENT_TILES }, (_, i) => (
            <li key={i} className="ptile skeleton">
              <i />
              <span>
                <i />
                <i />
              </span>
            </li>
          ))}
        </ul>
        <div className="rows">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="row skeleton">
              <i />
              <span>
                <i />
                <i />
              </span>
            </div>
          ))}
        </div>
      </div>,
    );
  }
  if (rooms.status === "error") {
    return wrap(
      <div className="empty" role="alert">
        <Icon name="alert" size={28} className="danger" />
        <b>Your rooms could not be loaded</b>
        <p>{rooms.error} Widgets that are already open keep running.</p>
        <Button kind="primary" icon="refresh" onClick={() => dispatch({ type: "picker/reloadRooms" })}>
          Try again
        </Button>
      </div>,
    );
  }

  const list = readyRooms(main);
  if (list.length === 0) {
    return wrap(
      <div className="empty">
        <Icon name="hash" size={28} />
        <b>No rooms</b>
        <p>This account has not joined a room yet.</p>
      </div>,
    );
  }

  // A recent whose room was left, or whose widget was removed or cannot be embedded, is skipped.
  const recentWidgets = main.data.recentWidgets
    .flatMap((recent) => {
      const room = roomOf(main, recent.roomId);
      const widget = room && roomWidgets(room, localWidgetsOf(main, room.id)).find((w) => w.key === recent.widgetKey && !w.problem);
      return room && widget ? [{ room, widget, open: widgetTab(main, widgetInstanceId(room.id, widget.key)) !== undefined }] : [];
    })
    .slice(0, RECENT_TILES);
  const recentRooms = main.data.recentRooms.flatMap((recent) => roomOf(main, recent.roomId) ?? []).slice(0, RECENT_TILES);

  const query = filter.trim();
  const matches = query ? list.filter((r) => r.name.toLowerCase().includes(query.toLowerCase())) : list;
  const search = (value: string) => {
    setFilter(value);
    setScrollRequest((n) => n + 1);
  };

  return wrap(
    <>
      {recentWidgets.length > 0 && (
        <Group id={`${ids}-widgets`} title="Recent widgets">
          <ul className="ptiles">
            {recentWidgets.map(({ room, widget, open: hasTab }) => (
              <Tile
                key={`${room.id}|${widget.key}`}
                label={hasTab ? `Jump to the tab of ${widget.name} in ${room.name}` : `Open ${widget.name} in ${room.name}`}
                avatar={<Avatar name={widget.name} id={widget.key} size={32} square label={initials(widget.name)} />}
                name={widget.name}
                sub={
                  <>
                    <span>{room.name}</span>
                    {hasTab && <span className="pill">open</span>}
                  </>
                }
                data-room-id={room.id}
                data-widget-key={widget.key}
                onClick={() => open(room.id, widget.key)}
              />
            ))}
          </ul>
        </Group>
      )}
      {recentRooms.length > 0 && (
        <Group id={`${ids}-rooms`} title="Recent rooms">
          <ul className="ptiles">
            {recentRooms.map((room) => (
              <Tile
                key={room.id}
                label={`Open ${room.name}`}
                avatar={<Avatar name={room.name} id={room.id} size={32} square mxc={room.avatarUrl} />}
                name={room.name}
                sub={<RoomCounts room={room} local={localWidgetsOf(main, room.id)} />}
                data-room-id={room.id}
                onClick={() => open(room.id)}
              />
            ))}
          </ul>
        </Group>
      )}
      <Group id={`${ids}-all`} title="All rooms" count={list.length} className={searched && (recentWidgets.length > 0 || recentRooms.length > 0) ? "searching" : ""} groupRef={allRooms}>
        <label className="input search">
          <Icon name="search" size={14} />
          <input
            type="search"
            aria-label="Search rooms"
            placeholder="Search rooms"
            value={filter}
            autoComplete="off"
            onFocus={() => {
              setSearched(true);
              setScrollRequest((n) => n + 1);
            }}
            onChange={(e) => search(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && filter) {
                e.preventDefault();
                e.stopPropagation();
                setFilter("");
              } else if (e.key === "Enter" && query && matches[0]) {
                // the first match is the highlighted row
                open(matches[0].id);
              }
            }}
          />
          {filter && <kbd title="Escape clears the search">Esc</kbd>}
        </label>
        <div className={`rows ${query ? "filtered" : ""}`}>
          {matches.map((room) => (
            <button key={room.id} type="button" className="row" data-room-id={room.id} onClick={() => open(room.id)}>
              <Avatar name={room.name} id={room.id} size={34} square mxc={room.avatarUrl} />
              <span className="row-main">
                <b>{marked(room.name, query)}</b>
                <small className="mono">{room.id}</small>
              </span>
              <span className="row-meta">
                <RoomCounts room={room} local={localWidgetsOf(main, room.id)} />
              </span>
              <Icon name="chevRight" size={14} className="end" />
            </button>
          ))}
        </div>
        {/* A live region: always there, with text only while searching. */}
        <p className="hint center" role="status">
          {query ? (matches.length ? `${matches.length} of ${list.length} rooms match “${query}”` : `No room matches “${query}”`) : ""}
        </p>
      </Group>
    </>,
  );
}
