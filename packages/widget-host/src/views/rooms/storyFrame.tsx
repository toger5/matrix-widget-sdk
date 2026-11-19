/** Wrappers of the rooms stories: what the app shell (or a story's stage) puts around a room panel. */
import type { ReactNode } from "react";

import type { MainViewModel, RoomPanelViewModel, SettingsViewModel, WidgetDevToolsLayout, WidgetInstanceViewModel } from "../../appViewModel";
import type { RenderWidget } from "../app/AppShell";
import { byId, mainVm, roomPanel, widgetTab, widgetVm, workspace } from "../fixtures";
import { WidgetView } from "../widget/WidgetView";
import { RoomPanel } from "./RoomPanel";

export const SETTINGS: SettingsViewModel = { devTools: false, devBackend: false, theme: "system" };
/** Both developer switches on. */
export const DEV_SETTINGS: SettingsViewModel = { devTools: true, devBackend: true, theme: "system" };

/** The running widgets of `main`: their WidgetView (without dev tools), which shows the fake widget of `StoryEnv`. */
export const fakeWidget =
  (main: MainViewModel): RenderWidget =>
  (id, options) => main.widgets[id] && <WidgetView widget={main.widgets[id]} compact={options?.compact} />;

/** The app background around the RoomsArea, filling the story. */
export function AppFrame({ children, fence = false, fullscreen = false }: { children: ReactNode; fence?: boolean; fullscreen?: boolean }) {
  return (
    <div className={`app ${fence ? "fence" : ""} ${fullscreen ? "fullscreen" : ""}`} style={{ height: "100vh" }}>
      {children}
    </div>
  );
}

/** One room panel on its own, filling the story. `renderWidget`: the running widgets (default: `fakeWidget`). `fence`: the DevBackend's background. */
export function SoloPanel({ main, panel, settings = SETTINGS, renderWidget, fence = false }: { main: MainViewModel; panel: RoomPanelViewModel; settings?: SettingsViewModel; renderWidget?: RenderWidget; fence?: boolean }) {
  return (
    <AppFrame fence={fence}>
      <main className="roomsarea">
        <RoomPanel main={main} settings={settings} panel={panel} focused renderWidget={renderWidget ?? fakeWidget(main)} />
      </main>
    </AppFrame>
  );
}

/**
 * The WidgetView `children` of `widget` (the call of "Design crit") in its tab body: the room
 * panel of "Design crit" with the call active and the whiteboard next to it. `devTools`: the
 * layout of the widget's dev tools (dev tools enabled, so the tab has its ⋯ button).
 */
export function InDesignPanel({ widget, devTools, children }: { widget: WidgetInstanceViewModel; devTools?: WidgetDevToolsLayout; children: ReactNode }) {
  const panel = roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board")]);
  const main = mainVm({ workspaces: { ada: workspace([panel], { devTools: devTools ? { [widget.id]: devTools } : {} }) }, widgets: byId([widget, widgetVm("design", "board")]) });
  return <SoloPanel main={main} panel={panel} settings={devTools ? DEV_SETTINGS : SETTINGS} renderWidget={(id) => (id === widget.id ? children : null)} />;
}

/** Only the header of a room panel: the body is cut off. */
export function HeadOnly({ main, panel, settings = SETTINGS }: { main: MainViewModel; panel: RoomPanelViewModel; settings?: SettingsViewModel }) {
  return (
    <div className="stage" style={{ height: "100vh", paddingBottom: 0 }}>
      <RoomPanel main={main} settings={settings} panel={panel} focused renderWidget={() => null} className="cut" />
    </div>
  );
}
