/**
 * Puts the controller and the views together. Rendered into the shadow root of the app's host
 * element; the widget iframes are rendered into the host element itself (its light DOM), where
 * the `<slot>`s of the views pick them up. See "Moving widgets without a reload" in
 * `implementationPlan.md`.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { widgetTab, type Loadable, type MockedRoomData, type WidgetDevToolsData, type WidgetInstanceViewModel } from "../appViewModel";
import type { RoomDetails } from "../session";
import { AppShell } from "../views/app/AppShell";
import { EMPTY_DEV_TOOLS_DATA, EMPTY_MOCKED_ROOM_DATA, ViewEnvContext, type ViewEnv } from "../views/env";
import { widgetSlotName } from "../views/ui/WidgetSlot";
import type { AppController } from "./controller";
import { Verification } from "./Verification";

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
      const selected = () => (controller.vm.screen.kind === "main" ? controller.vm.screen.main.devBackend?.selectedRoomId : undefined);
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
    avatar: async (mxcUrl) => controller.activeSession()?.avatar(mxcUrl),
    renderVerification: (accountId) => {
      const session = controller.session(accountId);
      return session ? <Verification session={session} /> : null;
    },
  };
}

/**
 * The iframes of the running widgets: one flat list in the light DOM of the host element, keyed
 * by widget (and start), in the order the widgets were started. An iframe is never moved; the
 * `<slot name="widget-…">` a view renders decides where it is shown.
 */
function WidgetIframes({ controller, widgets }: { controller: AppController; widgets: WidgetInstanceViewModel[] }) {
  return widgets
    .filter((w) => w.generation !== undefined)
    .map((w) => (
      <iframe
        key={`${w.id}#${w.generation}`}
        ref={(iframe) => controller.attachIframe(w.id, w.generation!, iframe)}
        slot={widgetSlotName(w.id)}
        data-widget-id={w.id}
        src={w.widget.url}
        title={w.widget.name}
        // Hidden until the widget reports that it is ready (`notify_ready`); the WidgetView shows the loading state meanwhile.
        hidden={w.load.state !== "ready"}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
        allow="camera; microphone; display-capture; autoplay; clipboard-write; fullscreen"
      />
    ));
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
