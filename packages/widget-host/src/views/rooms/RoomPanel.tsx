import { useRef } from "react";

import { hasTab, type MainViewModel, type RoomPanelViewModel, type SettingsViewModel } from "../../appViewModel";
import type { RenderWidget } from "../app/AppShell";
import { useDispatch } from "../env";
import { roomOf } from "../helpers";
import { IconButton } from "../ui/atoms";
import { RoomPicker } from "./RoomPicker";
import { RoomView } from "./RoomView";

export interface RoomPanelProps {
  main: MainViewModel;
  settings: SettingsViewModel;
  panel: RoomPanelViewModel;
  /** It is `roomsArea.focusedPanelId`. A press or a focus inside another panel makes that one the focused panel. */
  focused: boolean;
  fullscreen?: boolean;
  renderWidget: RenderWidget;
  /** e.g. "cut" in the tab bar stories. */
  className?: string;
}

/** One room panel of the RoomsArea, the rounded box: a RoomPicker (no room yet) or a RoomView. stories `rooms-roompicker--*`, `rooms-roomview--*` */
export function RoomPanel({ main, settings, panel, focused, fullscreen = false, renderWidget, className = "" }: RoomPanelProps) {
  const dispatch = useDispatch();
  const { content } = panel;
  // TODO-FINDING panel-focus-from-widget - a press inside a widget iframe reaches the host neither as a pointer nor as a focus event, so it does not make its panel the focused one. The runtime would have to report it (window `blur` + `document.activeElement` is the iframe).
  // A press also moves the keyboard focus into the panel: one intent for both.
  const pressing = useRef(false);
  const focus = () => {
    if (!focused && !pressing.current) dispatch({ type: "panel/focus", panelId: panel.id });
  };
  const endPress = () => {
    pressing.current = false;
  };
  // Alt+W closes the panel only when it has no tab besides the room name (else the active tab).
  const close = (
    <IconButton
      icon="x"
      title={hasTab(panel) ? "Close panel" : "Close panel (Alt+W)"}
      aria-label="Close panel"
      className="rp-close"
      onClick={() => dispatch({ type: "panel/close", panelId: panel.id })}
    />
  );
  const label = content.kind === "room" ? `Room panel: ${roomOf(main, content.roomId)?.name ?? content.roomId}` : "Room panel: choose a room";

  return (
    <section
      className={`roompanel ${className}`}
      style={{ flexGrow: panel.widthShare }}
      aria-label={label}
      data-testid="room-panel"
      data-panel-id={panel.id}
      data-room-id={content.kind === "room" ? content.roomId : undefined}
      data-focused={focused}
      onPointerDownCapture={() => {
        focus();
        pressing.current = true;
      }}
      onPointerUpCapture={endPress}
      onPointerCancelCapture={endPress}
      onPointerLeave={endPress}
      onFocusCapture={focus}
    >
      {content.kind === "room" ? (
        <RoomView main={main} settings={settings} panelId={panel.id} content={content} fullscreen={fullscreen} renderWidget={renderWidget} headerEnd={close} />
      ) : (
        <>
          <header className="rp-head">
            <span className="sp" />
            {close}
          </header>
          <div className="rp-body">
            <RoomPicker main={main} panelId={panel.id} />
          </div>
        </>
      )}
    </section>
  );
}
