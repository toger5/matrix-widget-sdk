import type { KeyboardEvent } from "react";

import type { SettingsViewModel } from "../../appViewModel";
import { useDispatch } from "../env";
import { Icon, Toggle, type IconName } from "../ui/atoms";
import { SideBox } from "./SideBox";

export interface SettingsViewProps {
  settings: SettingsViewModel;
  /** The DevBackend switch cannot be turned off while the DevBackend is active. */
  devBackendActive: boolean;
}

const THEMES: { value: SettingsViewModel["theme"]; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** What a switch enables, listed under it while it is on: [icon, name, where]. */
function SetList({ items }: { items: [IconName, string, string][] }) {
  return (
    <ul className="set-list on">
      {items.map(([icon, name, where]) => (
        <li key={name}>
          <Icon name={icon} size={14} />
          <span>
            <b>{name}</b> {where}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** stories `sidepanel-settingsview--*`. Two independent switches. */
export function SettingsView({ settings, devBackendActive }: SettingsViewProps) {
  const dispatch = useDispatch();
  const setTheme = (theme: SettingsViewModel["theme"]) => dispatch({ type: "settings/set", settings: { theme } });
  const locked = devBackendActive && settings.devBackend;

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
          <small>Inspect what a widget sees, and add your own widgets to a room.</small>
        </div>
        <Toggle on={settings.devTools} label="Enable dev tools" onChange={(devTools) => dispatch({ type: "settings/set", settings: { devTools } })} />
      </div>
      {settings.devTools && (
        <SetList
          items={[
            ["cone", "Dev tools", "button in the left bar: state and timeline of the open rooms"],
            ["dots", "Widget dev tools", "via the ⋯ button of a widget tab"],
            ["plus", "Add widget", "in the room overview"],
          ]}
        />
      )}
      <div className="set-row">
        <div>
          <b>Enable the DevBackend</b>
          <small>Mocked rooms in memory, without a homeserver.</small>
        </div>
        <Toggle on={settings.devBackend} label="Enable the DevBackend" disabled={locked} onChange={(devBackend) => dispatch({ type: "settings/set", settings: { devBackend } })} />
      </div>
      {locked && (
        <p className="hint set-locked">
          <Icon name="lock" size={13} />
          The DevBackend cannot be turned off while it is active
        </p>
      )}
      {settings.devBackend && (
        <SetList
          items={[
            ["users", "DevBackend", "in the account list and at the bottom of the dev tools"],
            ["copy", "Copy to DevBackend", "in the room overview"],
          ]}
        />
      )}
      {!settings.devTools && !settings.devBackend && <p className="hint">While both are off, no dev tool is shown anywhere in the app.</p>}
    </SideBox>
  );
}
