import type { AccountViewModel, LeftBarViewModel, SidePanelViewModel } from "../../appViewModel";
import { useDispatch } from "../env";
import { Avatar, DevAvatar, Icon, Logo, type IconName } from "../ui/atoms";

export interface LeftBarProps {
  leftBar: LeftBarViewModel;
  /** `devToolsAvailable`: shows the Dev tools button. */
  devTools: boolean;
  /** The Dev tools button is highlighted (and the DevBackend badge shown). */
  devBackendActive: boolean;
  /** The open SidePanel view, to mark its button. */
  sidePanelView?: SidePanelViewModel["view"];
  /** The active account (its avatar opens the AccountView). */
  account?: AccountViewModel;
}

interface LbButtonProps {
  icon: IconName;
  title: string;
  /** `undefined`: not a toggle (no `aria-pressed`). */
  pressed?: boolean;
  className?: string;
  /** A drawn tooltip replaces the native one. */
  noTitle?: boolean;
  onClick?: () => void;
}

function LbButton({ icon, title, pressed, className = "", noTitle, onClick }: LbButtonProps) {
  return (
    <button
      type="button"
      className={`lb-btn ${pressed ? "on" : ""} ${className}`}
      title={noTitle ? undefined : title}
      aria-label={title}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

/** stories `app-leftbar--*`. Renders nothing while collapsed (the AppShell shows the expand button and the toast). */
export function LeftBar({ leftBar, devTools, devBackendActive, sidePanelView, account }: LeftBarProps) {
  const dispatch = useDispatch();
  if (leftBar.collapsed) return null;

  return (
    <nav className="leftbar" aria-label="App" data-testid="leftbar">
      <button type="button" className="lb-logo" title="About this app" aria-label="About this app" onClick={() => dispatch({ type: "modal/open", modal: { kind: "appInfo" } })}>
        <Logo />
      </button>
      <LbButton icon="plus" title="New room panel (Alt+N) · with the same room: Alt+Shift+N" onClick={() => dispatch({ type: "panel/new" })} />
      <LbButton icon="list" title="Room list" pressed={sidePanelView === "rooms"} onClick={() => dispatch({ type: "sidePanel/toggle", view: "rooms" })} />
      {devTools && (
        <span className="lb-wrap">
          {/* It opens and closes the Dev tools, never switches accounts. */}
          <LbButton
            icon="cone"
            title="Dev tools"
            noTitle
            pressed={sidePanelView === "roomTools"}
            className={devBackendActive ? "dev-on" : ""}
            onClick={() => dispatch({ type: "sidePanel/toggle", view: "roomTools" })}
          />
          {/* TODO-FINDING tooltip-component - only this button has a drawn tooltip (as in story `app-leftbar--dev-backend-hover`; shown on hover and on keyboard focus). All other buttons still rely on `title`, which a keyboard user never sees. */}
          <span className="tooltip" aria-hidden="true">
            Dev tools
          </span>
        </span>
      )}
      {devBackendActive && (
        <span className="lb-badge" title="Widgets only see the DevBackend">
          DevBackend
        </span>
      )}
      <span className="sp" />
      <LbButton icon="settings" title="Settings" pressed={sidePanelView === "settings"} onClick={() => dispatch({ type: "sidePanel/toggle", view: "settings" })} />
      <button
        type="button"
        className={`lb-avatar ${sidePanelView === "account" ? "on" : ""}`}
        title="Account"
        aria-label={`Account${devBackendActive ? ": DevBackend" : ""}`}
        aria-pressed={sidePanelView === "account"}
        onClick={() => dispatch({ type: "sidePanel/toggle", view: "account" })}
      >
        {devBackendActive || !account ? <DevAvatar size={26} /> : <Avatar name={account.displayName ?? account.userId} id={account.userId} size={26} mxc={account.avatarUrl} />}
      </button>
      <LbButton icon="panelLeft" title="Collapse the bar" onClick={() => dispatch({ type: "leftBar/collapse" })} />
    </nav>
  );
}
