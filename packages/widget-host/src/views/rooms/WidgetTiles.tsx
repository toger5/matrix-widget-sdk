import { widgetInstanceId, widgetTab, type MainViewModel, type PanelId, type RoomId, type TabId } from "../../appViewModel";
import { useDispatch } from "../env";
import { roomOf, roomWidgets } from "../helpers";
import { Avatar, Icon, initials } from "../ui/atoms";
import { hostOf } from "./tabInfo";

export interface WidgetTilesProps {
  main: MainViewModel;
  panelId: PanelId;
  roomId: RoomId;
  /** Set when the tiles are the body of a "new" tab: picking a widget turns that tab into its tab. */
  tabId?: TabId;
}

/**
 * The widgets of a room as large, centered tiles: the body of a room without tabs and of a "new"
 * tab. leaves roomview/tiles, roomview/new-tab, roomview2/same. A widget runs once per account,
 * so a running one is grayed out and offers "jump to tab" (and "move widget here").
 */
export function WidgetTiles({ main, panelId, roomId, tabId }: WidgetTilesProps) {
  const dispatch = useDispatch();
  const room = roomOf(main, roomId);
  const newTab = tabId !== undefined;

  if (!room || room.widgetEvents === undefined) {
    const rooms = main.data.rooms;
    // TODO-FINDING room-view-without-room - a room panel whose room is not in `data.rooms` (still loading, failed, or the room was left) is not drawn. For now: the loading / error / "not available" state here, and the room id as the name in the header.
    return (
      <div className="tiles-wrap" data-testid="widget-tiles">
        {rooms.status === "error" ? (
          <div className="empty" role="alert">
            <Icon name="alert" size={28} className="danger" />
            <b>The widgets could not be loaded</b>
            <p>{rooms.error}</p>
          </div>
        ) : rooms.status === "loading" || room ? (
          <div className="empty" role="status">
            <span className="spinner" aria-hidden="true" />
            <b>Loading the widgets…</b>
          </div>
        ) : (
          <div className="empty">
            <Icon name="alert" size={28} />
            <b>This room is not available</b>
            <p>It is not one of the rooms of this account anymore.</p>
          </div>
        )}
      </div>
    );
  }

  const widgets = roomWidgets(room);
  if (widgets.length === 0) {
    return (
      <div className="tiles-wrap" data-testid="widget-tiles">
        <div className="empty">
          <Icon name="grid" size={28} />
          <b>No widgets in {room.name}</b>
          <p>Widgets that are added to this room show up here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="tiles-wrap" data-testid="widget-tiles">
      <h2>{newTab ? "Open another widget" : `Widgets in ${room.name}`}</h2>
      <p>{newTab ? "Widgets that are already open are grayed out." : "Pick a widget. It opens as the first tab."}</p>
      <div className="tiles">
        {widgets.map((w) => {
          const widgetId = widgetInstanceId(roomId, w.key);
          const avatar = (size: number) => <Avatar name={w.name} id={w.key} size={size} square label={initials(w.name)} />;
          if (w.problem) {
            // Not `disabled`: the tile stays focusable, so the problem can be read with the keyboard.
            return (
              <button key={w.key} type="button" className="tile problem" aria-disabled="true" aria-label={`${w.name} cannot be opened: ${w.problem}`} title={w.problem} data-widget-key={w.key}>
                <span className="tile-in">
                  {avatar(48)}
                  <b>{w.name}</b>
                  <small>{w.problem}</small>
                </span>
              </button>
            );
          }
          if (!main.widgets[widgetId]) {
            return (
              <button key={w.key} type="button" className="tile" aria-label={`Open ${w.name}`} data-widget-key={w.key} onClick={() => dispatch({ type: "tab/openWidget", panelId, tabId, widgetKey: w.key })}>
                <span className="tile-in">
                  {avatar(48)}
                  <b>{w.name}</b>
                  <small>{hostOf(w.event.content.url)}</small>
                </span>
              </button>
            );
          }
          const tab = widgetTab(main, widgetId);
          const elsewhere = tab?.panelId !== panelId;
          // TODO-FINDING tile-widget-without-tab - a running widget can have no tab at all (always on screen, its room panel was closed). The mockups only draw "open in this panel" and "open in the other panel". For now it is treated like "another panel": "jump to tab" opens its panel again, "move widget here" gives it a tab here.
          const where = !tab ? "running without a tab" : elsewhere ? "open in the other panel" : "open in this panel";
          return (
            <div key={w.key} className={`tile opened ${elsewhere ? "two" : ""}`} data-widget-key={w.key} data-widget-id={widgetId}>
              <span className="tile-in">
                {avatar(36)}
                <b>{w.name}</b>
                <small>{where}</small>
              </span>
              <span className="tile-acts">
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
                    onClick={() => dispatch({ type: "tab/moveWidgetHere", panelId, tabId, widgetId })}
                  >
                    <Icon name="arrowLeft" size={14} />
                    <span>Move widget here</span>
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
