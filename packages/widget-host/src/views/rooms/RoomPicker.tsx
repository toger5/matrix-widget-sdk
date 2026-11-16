import { useState, type ReactNode } from "react";

import type { MainViewModel, PanelId, RoomPickerViewModel } from "../../appViewModel";
import { useDispatch } from "../env";
import { readyRooms, roomOf, roomWidgets } from "../helpers";
import { Avatar, Button, Icon, initials, Toggle } from "../ui/atoms";

export interface RoomPickerProps {
  main: MainViewModel;
  panelId: PanelId;
  picker: RoomPickerViewModel;
}

/** "2 min ago", "yesterday", "Tuesday", "3 Nov": when a recent widget was opened last. */
function ago(timestamp: number, now = Date.now()): string {
  const minutes = Math.floor((now - timestamp) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  if (minutes < 48 * 60) return "yesterday";
  const date = new Date(timestamp);
  if (minutes < 7 * 24 * 60) return date.toLocaleDateString("en", { weekday: "long" });
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
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

/**
 * The body of a room panel without a room: no title, centered tiles of the recent widgets, or
 * (toggle "Show all rooms") the room list with a search field. leaves panel/*
 */
export function RoomPicker({ main, panelId, picker }: RoomPickerProps) {
  const dispatch = useDispatch();
  const [filter, setFilter] = useState("");
  const all = picker.mode === "allRooms";
  const rooms = main.data.rooms;

  const top = (
    <div className="picker-top">
      <span className="sp" />
      <label className="switch-row">
        <span>Show all rooms</span>
        <Toggle on={all} label="Show all rooms" onChange={(on) => dispatch({ type: "picker/setMode", panelId, mode: on ? "allRooms" : "recents" })} />
      </label>
    </div>
  );
  const centered = (inner: ReactNode) => (
    <div className="picker center" data-testid="room-picker">
      <div className="picker-in wide">
        {top}
        {inner}
      </div>
    </div>
  );

  // TODO-FINDING picker-loading-all-rooms - the loading and error leaves are only drawn for the recents mode; "all rooms" shows the same skeleton tiles and the same error block.
  if (rooms.status === "loading") {
    return centered(
      <div className="rtiles" role="status" aria-label={all ? "Loading your rooms" : "Loading your recent widgets"}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="rtile skeleton">
            <i />
            <i />
            <i />
          </div>
        ))}
      </div>,
    );
  }
  if (rooms.status === "error") {
    return centered(
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

  if (!all) {
    // A recent whose room was left or whose widget was removed is skipped.
    const recents = main.data.recents.flatMap((recent) => {
      const room = roomOf(main, recent.roomId);
      const widget = roomWidgets(room).find((w) => w.key === recent.widgetKey);
      return room && widget ? [{ recent, room, widget }] : [];
    });
    if (recents.length === 0) {
      return centered(
        <div className="empty">
          <Icon name="clock" size={28} />
          <b>No recent widgets yet</b>
          <p>Widgets you open show up here, so you can get back to them in one click.</p>
          <Button kind="primary" onClick={() => dispatch({ type: "picker/setMode", panelId, mode: "allRooms" })}>
            Show all rooms
          </Button>
        </div>,
      );
    }
    return centered(
      <div className="rtiles">
        {recents.map(({ recent, room, widget }) => (
          <button
            key={`${room.id}|${widget.key}`}
            type="button"
            className="rtile"
            title={`Open ${widget.name} in ${room.name}`}
            aria-label={`Open ${widget.name} in ${room.name}`}
            data-room-id={room.id}
            data-widget-key={widget.key}
            onClick={() => dispatch({ type: "panel/openRoom", panelId, roomId: room.id, widgetKey: widget.key })}
          >
            <span className="rtile-h">
              <Avatar name={room.name} id={room.id} size={16} square mxc={room.avatarUrl} />
              <span>{room.name}</span>
            </span>
            <span className="rtile-m">
              <Avatar name={widget.name} id={widget.key} size={36} square label={initials(widget.name)} />
              <b>{widget.name}</b>
            </span>
            <span className="rtile-f">
              <span>{ago(recent.lastOpened)}</span>
              <span className="btn sm">Open</span>
            </span>
          </button>
        ))}
      </div>,
    );
  }

  const list = readyRooms(main);
  const query = filter.trim();
  const matches = query ? list.filter((r) => r.name.toLowerCase().includes(query.toLowerCase())) : list;
  const open = (roomId: string) => dispatch({ type: "panel/openRoom", panelId, roomId });

  return (
    <div className="picker" data-testid="room-picker">
      <div className="picker-in">
        {top}
        <label className="input search">
          <Icon name="search" size={14} />
          <input
            type="search"
            aria-label="Search rooms"
            placeholder="Search rooms"
            value={filter}
            autoComplete="off"
            onChange={(e) => setFilter(e.target.value)}
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
        {list.length === 0 ? (
          <div className="empty">
            <Icon name="hash" size={28} />
            <b>No rooms</b>
            <p>This account has not joined a room yet.</p>
          </div>
        ) : (
          <>
            <div className={`rows ${query ? "filtered" : ""}`}>
              {matches.map((room) => {
                const widgets = roomWidgets(room).length;
                return (
                  <button key={room.id} type="button" className="row" data-room-id={room.id} onClick={() => open(room.id)}>
                    <Avatar name={room.name} id={room.id} size={34} square mxc={room.avatarUrl} />
                    <span className="row-main">
                      <b>{marked(room.name, query)}</b>
                      <small className="mono">{room.id}</small>
                    </span>
                    <span className="row-meta">
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
                    </span>
                    <Icon name="chevRight" size={14} className="end" />
                  </button>
                );
              })}
            </div>
            <p className="hint center" role="status">
              {query ? (matches.length ? `${matches.length} of ${list.length} rooms match “${query}”` : `No room matches “${query}”`) : `${list.length} ${list.length === 1 ? "room" : "rooms"}`}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
