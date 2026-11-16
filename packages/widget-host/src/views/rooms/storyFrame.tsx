/** Wrappers of the rooms stories: what the app shell (or a mockup's stage) puts around a room panel. */
import type { ReactNode } from "react";

import type { MainViewModel, RoomPanelViewModel, SettingsViewModel } from "../../appViewModel";
import type { RenderWidget } from "../app/AppShell";
import { FakeWidget } from "../storyEnv";
import { RoomPanel } from "./RoomPanel";

export const SETTINGS: SettingsViewModel = { devTools: false, devBackend: false, theme: "system" };
/** Both developer switches on. */
export const DEV_SETTINGS: SettingsViewModel = { devTools: true, devBackend: true, theme: "system" };

/** The stand-in for a running widget: named after the widget. */
export const fakeWidget =
  (main: MainViewModel): RenderWidget =>
  (id) => <FakeWidget name={main.widgets[id]?.widget.name} />;

/** `app({ panels })` of the mockups: the app background around the RoomsArea, filling the story. */
export function AppFrame({ children, fence = false, fullscreen = false }: { children: ReactNode; fence?: boolean; fullscreen?: boolean }) {
  return (
    <div className={`app ${fence ? "fence" : ""} ${fullscreen ? "fullscreen" : ""}`} style={{ height: "100vh" }}>
      {children}
    </div>
  );
}

/** One room panel on its own (`solo()` of the mockups). */
export function SoloPanel({ main, panel, settings = SETTINGS }: { main: MainViewModel; panel: RoomPanelViewModel; settings?: SettingsViewModel }) {
  return (
    <AppFrame>
      <main className="roomsarea">
        <RoomPanel main={main} settings={settings} panel={panel} focused renderWidget={fakeWidget(main)} />
      </main>
    </AppFrame>
  );
}

/** Only the header of a room panel (`headOnly()` of the mockups): the body is cut off. */
export function HeadOnly({ main, panel, settings = SETTINGS }: { main: MainViewModel; panel: RoomPanelViewModel; settings?: SettingsViewModel }) {
  return (
    <div className="stage" style={{ height: "100vh", paddingBottom: 0 }}>
      <RoomPanel main={main} settings={settings} panel={panel} focused renderWidget={() => null} className="cut" />
    </div>
  );
}
