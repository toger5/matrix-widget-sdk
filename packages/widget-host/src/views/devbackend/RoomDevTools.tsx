/**
 * The room dev tools: the bar of the widget dev tools (`DevToolsBar`: status dot, the State and
 * Timeline toggles, the dock switch) over the State and Timeline panels of one room, and for a
 * Matrix account the "sending as" line. In the SidePanel (`RoomBox`, bar on the left) and in a room
 * dev tools tab (`RoomView`, bar on top). As in the widget dev tools, docked left or right the panels
 * stack, docked top or bottom they sit side by side. The state and the timeline are read with
 * `useViewEnv().useRoomTimeline` and `useRoomState`, the same way in both modes.
 * stories `rooms-roomdevtools--*`, `sidepanel-roomtoolsview--*`, `sidepanel-devbackendview*--*`
 */
import { Fragment, useRef, type ReactNode } from "react";

import {
  roomStateVersion,
  sideDock,
  type MockedPagination,
  type MockedStateEvent,
  type RoomDevToolPanel,
  type RoomDevToolsLayout,
  type RoomDevToolsTarget,
  type RoomId,
  type RoomToolsViewModel,
  type ScheduledEvent,
} from "../../appViewModel";
import type { RawEvent } from "../../session";
import { useDispatch, useViewEnv } from "../env";
import { plural } from "../helpers";
import { Button, Icon, IconButton, type IconName } from "../ui/atoms";
import { DevToolsBar, type BarStatus } from "../ui/DevToolsBar";
import { PanelSplit, pairLength } from "../ui/Separator";
import type { RoomBoxMode } from "./RoomBox";
import { StateSection } from "./StateSection";
import { TimelineSection } from "./TimelineSection";

/** Icon and label of each panel, in bar order. */
const PANELS: Record<RoomDevToolPanel, { icon: IconName; label: string }> = {
  state: { icon: "list", label: "State" },
  timeline: { icon: "message", label: "Timeline" },
};

const STATUS: Record<BarStatus["cls"], BarStatus> = {
  ok: { cls: "ok", label: "Room data is ready" },
  wait: { cls: "wait", label: "Room data is loading" },
  err: { cls: "err", label: "Room data failed to load" },
};

/** A state event of the room as the forms of the State panel take it. */
const asStateEvent = (event: RawEvent): MockedStateEvent => ({ type: event.type, stateKey: String(event.state_key), content: event.content });

export interface RoomDevToolsProps {
  mode: RoomBoxMode;
  roomId: RoomId;
  layout: RoomDevToolsLayout;
  /** Which room dev tools the bar's intents change: the SidePanel's or a room tab's. */
  target: RoomDevToolsTarget;
  /** The forms the send forms show (`RoomToolsViewModel`, shared by all room dev tools). */
  forms: Pick<RoomToolsViewModel, "sendForm" | "stateForm">;
  /** The DevBackend's user (the default sender) or the account (the only sender). */
  userId?: string;
  /** The delayed events of the room that "Scheduled" lists. */
  scheduled: ScheduledEvent[];
  /** DevBackend: the pagination of the room's timeline cache (a widget's request to resolve). */
  pagination?: MockedPagination;
}

export function RoomDevTools({ mode, roomId, layout, target, forms, userId, scheduled, pagination }: RoomDevToolsProps) {
  const dispatch = useDispatch();
  const env = useViewEnv();
  const { timeline, retry: retryTimeline } = env.useRoomTimeline(roomId);
  const { state, retry: retryState } = env.useRoomState(roomId, roomStateVersion(timeline));
  const panelsRef = useRef<HTMLDivElement>(null);
  const { dock, panels } = layout;
  const vertical = sideDock(dock);

  const stateEvents = state.status === "ready" ? state.value.filter((e) => typeof e.state_key === "string").map(asStateEvent) : [];
  const members = stateEvents.filter((e) => e.type === "m.room.member").map((e) => e.stateKey);
  const events = timeline.status === "ready" ? timeline.value.events : [];
  const status = state.status === "error" || timeline.status === "error" ? STATUS.err : state.status === "ready" && timeline.status === "ready" ? STATUS.ok : STATUS.wait;
  const loadState = { state: state.status, timeline: timeline.status };
  const counts = { state: stateEvents.length, timeline: events.length };
  const open = new Set(panels.map((p) => p.panel));
  const toggle = (panel: RoomDevToolPanel) => dispatch({ type: "roomDevTools/togglePanel", target, panel });

  /** The header's counts: "10 · 6 types", "5 · 1 scheduled". */
  const headerCount = (panel: RoomDevToolPanel) => {
    if (loadState[panel] !== "ready") return undefined;
    if (panel === "state") return `${counts.state} · ${plural(new Set(stateEvents.map((e) => e.type)).size, "type")}`;
    return [String(counts.timeline), scheduled.length ? `${scheduled.length} scheduled` : ""].filter(Boolean).join(" · ");
  };

  const body = (panel: RoomDevToolPanel): ReactNode => {
    if (panel === "state") {
      if (state.status === "ready") return <StateSection key={roomId} mode={mode} roomId={roomId} state={stateEvents} stateForm={forms.stateForm} userId={userId} />;
      if (state.status === "loading") return <PanelLoading text="Reading the room state…" />;
      return <PanelFailed title="The room state could not be read." error={state.error} retry={retryState} />;
    }
    if (timeline.status === "ready") {
      return (
        <TimelineSection
          key={roomId}
          mode={mode}
          roomId={roomId}
          sendForm={forms.sendForm}
          events={events}
          atStart={timeline.value.atStart}
          loadingOlder={timeline.value.loadingOlder}
          scheduled={scheduled}
          pagination={pagination}
          userId={userId}
          members={members}
        />
      );
    }
    if (timeline.status === "loading") return <PanelLoading text="Loading the timeline…" />;
    return <PanelFailed title="The timeline could not be loaded." error={timeline.error} retry={retryTimeline} />;
  };

  return (
    <div className={`dt rdt dt-${dock}`} data-testid="room-dev-tools" data-room-id={roomId}>
      <DevToolsBar
        label="Room dev tools"
        title="Room dev tools"
        status={status}
        toggles={(Object.keys(PANELS) as RoomDevToolPanel[]).map((panel) => {
          const { icon, label } = PANELS[panel];
          const failed = loadState[panel] === "error";
          const count = loadState[panel] === "ready" ? counts[panel] : 0;
          return {
            panel,
            icon,
            label,
            name: failed ? `${label}, failed to load` : count ? `${label}, ${count}` : label,
            pressed: open.has(panel),
            badge: failed ? { error: true } : count ? { count } : undefined,
            onToggle: () => toggle(panel),
          };
        })}
        dock={dock}
        onDock={(next) => dispatch({ type: "roomDevTools/dock", target, dock: next })}
      />
      <div className="rdt-main">
        <div className="dt-panels" ref={panelsRef}>
          {panels.map(({ panel, share }, i) => {
            const { icon, label } = PANELS[panel];
            const next = panels[i + 1];
            const count = headerCount(panel);
            return (
              <Fragment key={panel}>
                <section className={`dt-panel dtp-${panel}`} style={{ flexGrow: share }} aria-label={label} data-dev-panel={panel}>
                  <header className="dt-ph">
                    <Icon name={icon} size={12} />
                    <span>{label}</span>
                    {count && <em>{count}</em>}
                    <span className="sp" />
                    <IconButton icon="x" title={`Close ${label}`} className="xs" onClick={() => toggle(panel)} />
                  </header>
                  <div className="dt-pb">{body(panel)}</div>
                </section>
                {next && (
                  <PanelSplit
                    i={i}
                    shares={panels.map((p) => p.share)}
                    vertical={vertical}
                    label={`Resize the dev tool panels ${label} and ${PANELS[next.panel].label}`}
                    valueLabel={label}
                    pairPx={() => pairLength(panelsRef.current, i, vertical)}
                    onShares={(shares) => dispatch({ type: "roomDevTools/resize", target, shares })}
                  />
                )}
              </Fragment>
            );
          })}
        </div>
        {mode === "account" && userId && (
          <p className="rdt-status" title={`Everything you send here goes to the room as ${userId}, and everyone in the room sees it.`}>
            <Icon name="alert" size={12} />
            <span>
              Sending as <b>{userId}</b> · visible to everyone in the room
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

function PanelLoading({ text }: { text: string }) {
  return (
    <div className="dt-empty" role="status">
      <span className="spinner" aria-hidden="true" />
      {text}
    </div>
  );
}

function PanelFailed({ title, error, retry }: { title: string; error: string; retry: () => void }) {
  return (
    <div className="dt-empty" role="alert">
      <Icon name="alert" size={18} />
      <b>{title}</b> {error}
      <br />
      <Button sm icon="refresh" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}
