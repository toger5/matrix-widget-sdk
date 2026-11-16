/**
 * `window.widgetHost`: what scripted runs (Playwright, `e2e/`) use instead of clicking through the
 * DevBackendView and instead of reading the dev tool panels' DOM, which is collapsed and capped.
 */
import type { DriverSnapshot } from "@matrix-widget-tools/widget-host-bindings";

import type { AppIntent, AppViewModel, RoomId, WidgetDevToolsData, WidgetInstanceId } from "../appViewModel";
import { stringify } from "../lib/format";
import type { AppController, HostSeed } from "./controller";

export interface WidgetHostTestHook {
  /** Reset the app to the DevBackend with exactly this content and screen. Resolves when the screen is set up (widgets may still be loading). */
  populate(seed: HostSeed): Promise<void>;
  state(): AppViewModel;
  dispatch(intent: AppIntent): void;
  /** Ids of the running widgets (`<room id>|<widget key>`). */
  widgets(): WidgetInstanceId[];
  /** Every envelope that crossed the wire of a widget, oldest first. */
  messages(widgetId: WidgetInstanceId): { direction: "fromWidget" | "toWidget"; message: unknown }[];
  driverSnapshot(widgetId: WidgetInstanceId): DriverSnapshot | undefined;
  devTools(widgetId: WidgetInstanceId): WidgetDevToolsData | undefined;
  /** What the DevBackend holds for a mocked room, as plain JSON. */
  store(roomId: RoomId): unknown;
}

declare global {
  interface Window {
    widgetHost?: WidgetHostTestHook;
  }
}

export function installTestHook(controller: AppController): void {
  window.widgetHost = {
    populate: (seed) => controller.populate(seed),
    state: () => controller.vm,
    dispatch: controller.dispatch,
    widgets: () => (controller.vm.screen.kind === "main" ? Object.keys(controller.vm.screen.main.widgets) : []),
    messages: (id) => controller.runtime(id)?.wireLog ?? [],
    driverSnapshot: (id) => controller.runtime(id)?.snapshot(),
    devTools: (id) => controller.runtime(id)?.devTools.get(),
    store: (roomId) => {
      const dev = controller.getDevBackend();
      if (!dev?.roomIds().includes(roomId)) return undefined;
      const store = dev.store(roomId);
      return JSON.parse(stringify({ timeline: store.timeline(), state: store.state(), delayed: store.delayedEvents(), toDeviceSent: store.toDeviceSent() }));
    },
  };
}
