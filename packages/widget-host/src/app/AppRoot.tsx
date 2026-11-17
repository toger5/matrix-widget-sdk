/**
 * Puts the controller and the views together. Rendered into the shadow root of the app's host
 * element; the widget iframes are rendered into the host element itself (its light DOM), where
 * the `<slot>`s of the views pick them up. See "Moving widgets without a reload" in
 * `implementationPlan.md`.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { widgetTab, type Loadable, type MockedRoomData, type WidgetDevToolsData, type WidgetInstanceViewModel } from "../appViewModel";
import { hostWidgetEvents } from "../lib/widgetEvents";
import type { RawEvent, RoomDetails, RoomTimeline } from "../session";
import { AppShell } from "../views/app/AppShell";
import { EMPTY_DEV_TOOLS_DATA, EMPTY_MOCKED_ROOM_DATA, ViewEnvContext, type RoomStateData, type RoomTimelineData, type ViewEnv } from "../views/env";
import { widgetSlotName } from "../views/ui/WidgetSlot";
import { DEV_ACCOUNT_ID, type AppController } from "./controller";

const NARROW = "(max-width: 900px)";
const noSubscription = () => () => {};

function useNarrow(): boolean {
  const query = useMemo(() => matchMedia(NARROW), []);
  return useSyncExternalStore(
    (onChange) => {
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => query.matches,
  );
}

/** The data hooks of the views, on the controller's runtime. */
function viewEnv(controller: AppController, narrow: boolean): ViewEnv {
  return {
    dispatch: controller.dispatch,
    narrow,
    useDevToolsData: (widgetId): WidgetDevToolsData => {
      // The runtime exists once the widget's backend arrived; the view renders again then (`generation` changes).
      const store = controller.runtime(widgetId)?.devTools;
      return useSyncExternalStore(store?.subscribe ?? noSubscription, store?.get ?? (() => EMPTY_DEV_TOOLS_DATA));
    },
    useMockedRoomData: (): MockedRoomData => {
      const dev = controller.getDevBackend();
      // The mocked room picked in the Dev tools: its scheduled events.
      const selected = () => (controller.vm.screen.kind === "main" ? controller.vm.screen.main.roomTools?.selectedRoomIds[DEV_ACCOUNT_ID] : undefined);
      return useSyncExternalStore(dev ? (onChange) => dev.subscribe(onChange) : noSubscription, () => dev?.snapshot(selected()) ?? EMPTY_MOCKED_ROOM_DATA);
    },
    useRoomDetails: (roomId): Loadable<RoomDetails> => {
      const session = controller.activeSession();
      const [details, setDetails] = useState<Loadable<RoomDetails>>({ status: "loading" });
      useEffect(() => {
        if (!session) return;
        let cancelled = false;
        const load = () =>
          session.roomDetails(roomId).then(
            (value) => !cancelled && setDetails({ status: "ready", value }),
            (e: unknown) => !cancelled && setDetails({ status: "error", error: e instanceof Error ? e.message : String(e) }),
          );
        void load();
        const stop = session.onRoomsChanged(() => void load());
        return () => {
          cancelled = true;
          stop();
        };
      }, [session, roomId]);
      return details;
    },
    useRoomTimeline: (roomId): RoomTimelineData => {
      const session = controller.activeSession();
      const [timeline, setTimeline] = useState<Loadable<RoomTimeline>>({ status: "loading" });
      const [attempt, setAttempt] = useState(0);
      useEffect(() => {
        if (!session) return;
        let cancelled = false;
        // One read at a time; a change during a read leads to one more read after it.
        let running = false;
        let again = false;
        const load = async () => {
          if (running) return void (again = true);
          running = true;
          do {
            again = false;
            try {
              const value = await session.timeline(roomId);
              if (!cancelled) setTimeline({ status: "ready", value });
            } catch (e) {
              if (!cancelled) setTimeline({ status: "error", error: e instanceof Error ? e.message : String(e) });
            }
          } while (again && !cancelled);
          running = false;
        };
        const stop = session.onTimelineChanged(roomId, () => void load());
        void load();
        return () => {
          cancelled = true;
          stop();
        };
      }, [session, roomId, attempt]);
      const retry = useCallback(() => {
        setTimeline({ status: "loading" });
        setAttempt((n) => n + 1);
      }, []);
      return useMemo(() => ({ timeline, retry }), [timeline, retry]);
    },
    // TODO-FINDING room-tools-state-refresh - the whole state is read again on every new state event of the room's timeline (`roomStateVersion`): one `/state` request each time in both SDKs. Options: apply the state event to the state read before, or a state change listener per SDK.
    useRoomState: (roomId, version): RoomStateData => {
      const session = controller.activeSession();
      const [state, setState] = useState<Loadable<RawEvent[]>>({ status: "loading" });
      const [attempt, setAttempt] = useState(0);
      useEffect(() => {
        // Read once the timeline says which version to read; a new version reads again and shows the old state meanwhile.
        if (!session || version === undefined) return;
        let cancelled = false;
        session.roomState(roomId).then(
          (value) => !cancelled && setState({ status: "ready", value }),
          (e: unknown) => !cancelled && setState({ status: "error", error: e instanceof Error ? e.message : String(e) }),
        );
        return () => {
          cancelled = true;
        };
      }, [session, roomId, version, attempt]);
      const retry = useCallback(() => {
        setState({ status: "loading" });
        setAttempt((n) => n + 1);
      }, []);
      return useMemo(() => ({ state, retry }), [state, retry]);
    },
    avatar: async (mxcUrl) => controller.activeSession()?.avatar(mxcUrl),
    widgetEvents: hostWidgetEvents,
  };
}

/**
 * The iframes of the running widgets: one flat list in the light DOM of the host element, keyed
 * by widget (and start), in the order the widgets were started. An iframe is never moved; the
 * `<slot name="widget-…">` a view renders decides where it is shown. Its `src`, `sandbox` and `allow`
 * are what the driver said (`WidgetInstanceViewModel.iframe`, `WidgetHostPlatform.loadIframe`; the
 * attributes are made from the widget's webview capabilities, strict unless granted): when they
 * change the driver says so again, which is a new generation, so a new iframe.
 */
function WidgetIframes({ controller, widgets }: { controller: AppController; widgets: WidgetInstanceViewModel[] }) {
  return widgets.flatMap(({ id, generation, iframe, widget, load }) =>
    generation === undefined || iframe === undefined
      ? []
      : [
          <iframe
            key={`${id}#${generation}`}
            ref={(iframe) => controller.attachIframe(id, generation, iframe)}
            slot={widgetSlotName(id)}
            data-widget-id={id}
            src={iframe.url}
            title={widget.name}
            // Hidden until the driver reports the widget ready (`notify_ready`; at once without the widget API); the WidgetView shows the loading state meanwhile.
            hidden={load.state !== "ready"}
            sandbox={iframe.sandbox}
            allow={iframe.allow}
          />,
        ],
  );
}

export function AppRoot({ controller, host }: { controller: AppController; host: HTMLElement }) {
  const vm = useSyncExternalStore(controller.store.subscribe, controller.store.get);
  const narrow = useNarrow();
  const env = useMemo(() => viewEnv(controller, narrow), [controller, narrow]);
  const widgets = vm.screen.kind === "main" ? Object.values(vm.screen.main.widgets) : [];

  // A press inside a widget never reaches the host. The window loses the focus to the iframe
  // instead: that is the moment to focus the widget's room panel (the target of the shortcuts).
  useEffect(() => {
    const onBlur = () => {
      const id = document.activeElement instanceof HTMLIFrameElement ? document.activeElement.dataset.widgetId : undefined;
      const main = controller.vm.screen.kind === "main" ? controller.vm.screen.main : undefined;
      const tab = id && main ? widgetTab(main, id) : undefined;
      if (tab) controller.dispatch({ type: "panel/focus", panelId: tab.panelId });
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [controller]);
  return (
    <ViewEnvContext.Provider value={env}>
      <AppShell vm={vm} />
      {createPortal(<WidgetIframes controller={controller} widgets={widgets} />, host)}
    </ViewEnvContext.Provider>
  );
}
