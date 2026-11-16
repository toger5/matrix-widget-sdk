import type { KeyboardEvent } from "react";

import type { SettingsViewModel } from "../../appViewModel";
import { useDispatch } from "../env";
import { Icon, Toggle } from "../ui/atoms";
import { SideBox } from "./SideBox";

export interface SettingsViewProps {
  settings: SettingsViewModel;
  /** Dev tools cannot be turned off while the DevBackend is active. */
  devBackendActive: boolean;
}

const THEMES: { value: SettingsViewModel["theme"]; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** leaves sidepanel/settings-on, settings-off. */
export function SettingsView({ settings, devBackendActive }: SettingsViewProps) {
  const dispatch = useDispatch();
  const setTheme = (theme: SettingsViewModel["theme"]) => dispatch({ type: "settings/set", settings: { theme } });
  const locked = devBackendActive && settings.devTools;

  // Radio group: the arrow keys move the selection (and the focus with it).
  const onThemeKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const index = (THEMES.findIndex((t) => t.value === settings.theme) + step + THEMES.length) % THEMES.length;
    setTheme(THEMES[index].value);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus();
  };

  return (
    <SideBox title="Settings" className="settings" testId="settings-view">
      <h4 className="side-h">Appearance</h4>
      <div className="set-row">
        <div>
          <b>Theme</b>
          <small>Follows the system unless you choose one.</small>
        </div>
      </div>
      <div className="seg" role="radiogroup" aria-label="Theme" onKeyDown={onThemeKey}>
        {THEMES.map((t) => {
          const on = settings.theme === t.value;
          return (
            <button key={t.value} type="button" className={on ? "on" : ""} role="radio" aria-checked={on} tabIndex={on ? 0 : -1} onClick={() => setTheme(t.value)}>
              {t.label}
            </button>
          );
        })}
      </div>
      <h4 className="side-h">Developer</h4>
      <div className="set-row">
        <div>
          <b>Enable dev tools</b>
          <small>Tools to inspect and mock what a widget sees.</small>
        </div>
        <Toggle on={settings.devTools} label="Enable dev tools" disabled={locked} onChange={(devTools) => dispatch({ type: "settings/set", settings: { devTools } })} />
      </div>
      {locked && (
        <p className="hint set-locked">
          <Icon name="lock" size={13} />
          Dev tools cannot be turned off while the DevBackend is active
        </p>
      )}
      {settings.devTools ? (
        <ul className="set-list on">
          <li>
            <Icon name="cone" size={14} />
            <span>
              <b>DevBackend</b> button in the left bar
            </span>
          </li>
          <li>
            <Icon name="dots" size={14} />
            <span>
              <b>Widget dev tools</b> via the ⋯ button of a widget tab
            </span>
          </li>
          <li>
            <Icon name="copy" size={14} />
            <span>
              <b>Copy to DevBackend</b> in the room overview
            </span>
          </li>
        </ul>
      ) : (
        <p className="hint">While this is off, no dev tool is shown anywhere in the app.</p>
      )}
    </SideBox>
  );
}
