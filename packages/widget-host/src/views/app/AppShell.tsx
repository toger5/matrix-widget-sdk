import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";

import {
  PIP_VISIBLE_BOXES,
  activeAccount,
  activeWorkspace,
  devBackendActive,
  devToolsAvailable,
  fullscreenWidget,
  hasTab,
  pipWidgetIds,
  widgetTab,
  type AppViewModel,
  type MainViewModel,
  type SettingsViewModel,
  type WidgetDevToolsLayout,
  type WidgetInstanceId,
} from "../../appViewModel";
import { useDispatch, useViewEnv } from "../env";
import { roomOf } from "../helpers";
import { PipPanel, type PipItem } from "../pip/PipPanel";
import { RoomsArea } from "../rooms/RoomsArea";
import { SidePanel } from "../sidepanel/SidePanel";
import { Icon, IconButton, Logo } from "../ui/atoms";
import { WidgetView } from "../widget/WidgetView";
import { LeftBar } from "./LeftBar";
import { LoginView } from "./LoginView";
import { Modal } from "./Modal";

/** Renders one running widget (its `WidgetView`: dev tools around a `WidgetSlot`). `compact`: inside a PiP box. */
export type RenderWidget = (widgetId: WidgetInstanceId, options?: { compact?: boolean }) => ReactNode;

export interface AppShellProps {
  vm: AppViewModel;
  /** Stories only: draw in this theme instead of the one `settings.theme` resolves to (the Settings still show their choice). */
  storyTheme?: "light" | "dark";
}

const CLOSED_DEV_TOOLS: WidgetDevToolsLayout = { open: false, dock: "top", panels: [], size: { top: 240, side: 360 } };

/** "system" follows `prefers-color-scheme`, live. */
function useResolvedTheme(theme: SettingsViewModel["theme"]): "light" | "dark" {
  const [systemDark, setSystemDark] = useState(() => globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true);
  useEffect(() => {
    const query = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;
    const onChange = () => setSystemDark(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

/** The root view: the restoring screen, the login page, or the main screen (LeftBar, SidePanel, RoomsArea, PiP, modal, toasts). */
export function AppShell({ vm, storyTheme }: AppShellProps) {
  const resolved = useResolvedTheme(vm.settings.theme);
  const theme = storyTheme ?? resolved;
  const { screen } = vm;
  return (
    <div className="app-root" data-theme={theme}>
      {screen.kind === "restoring" && (
        <div className="app login-page" data-testid="app-restoring">
          <div className="restoring" role="status">
            <Logo size={40} />
            <span className="spinner" aria-hidden="true" />
            <span className="muted">Looking for your accounts…</span>
          </div>
        </div>
      )}
      {screen.kind === "login" && <LoginView login={screen.login} />}
      {screen.kind === "main" && <MainScreen vm={vm} main={screen.main} />}
    </div>
  );
}

/** Wraps the key names of a toast in `<kbd>`, as the design draws them. */
function toastText(text: string): ReactNode {
  // TODO-FINDING toast-text-markup - `ToastViewModel.text` is a plain string, the designed toast has `<kbd>Esc</kbd>`. For now the words Esc, Alt, Shift and Ctrl are drawn as keys.
  return text.split(/\b(Esc|Alt|Shift|Ctrl)\b/).map((part, i) => (i % 2 ? <kbd key={i}>{part}</kbd> : <Fragment key={i}>{part}</Fragment>));
}

const NOT_TEXT_INPUTS = new Set(["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"]);

/** The Alt shortcuts are off while typing: on macOS Option+letter types a character. */
function isTextField(target: EventTarget | undefined): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return !NOT_TEXT_INPUTS.has(target.type);
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable;
}

function MainScreen({ vm, main }: { vm: AppViewModel; main: MainViewModel }) {
  const dispatch = useDispatch();
  const { narrow } = useViewEnv();
  const { settings } = vm;
  const workspace = activeWorkspace(main);
  const fence = devBackendActive(vm);
  const fullscreen = fullscreenWidget(vm) !== undefined;
  const { collapsed, expandButtonVisible } = main.leftBar;
  const panels = workspace?.roomsArea.panels ?? [];
  const focusedPanelId = workspace?.roomsArea.focusedPanelId;
  const focusedPanel = panels.find((p) => p.id === focusedPanelId);
  const modalOpen = !!main.modal || !!main.addAccount;

  const renderWidget = useCallback(
    (id: WidgetInstanceId, options?: { compact?: boolean }) => {
      const widget = main.widgets[id];
      if (!widget) return null;
      const tab = widgetTab(main, id);
      return (
        <WidgetView
          widget={widget}
          devTools={settings.devTools ? (workspace?.devTools[id] ?? CLOSED_DEV_TOOLS) : undefined}
          compact={options?.compact}
          tab={tab && { panelId: tab.panelId, tabId: tab.tabId }}
        />
      );
    },
    [main, settings.devTools, workspace],
  );

  // Keyboard shortcuts (docs/product.md, Details > Keyboard). `code`, not `key`: Alt changes `key` on macOS.
  const activeTabId = focusedPanel?.content.kind === "room" ? focusedPanel.content.activeTabId : undefined;
  const altWClosesPanel = !!focusedPanel && !hasTab(focusedPanel);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape") {
        // TODO-FINDING escape-in-widget - while a widget iframe has the focus the host gets no key events; only the mouse at the left edge reveals the expand button then.
        if (collapsed && !expandButtonVisible && !modalOpen) dispatch({ type: "leftBar/revealExpandButton" });
        return;
      }
      // Ctrl+K / Cmd+K: the room picker dialog (again: closes it); also while typing, not over another dialog.
      if (e.code === "KeyK" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        if (main.addAccount || (main.modal && main.modal.kind !== "roomPicker")) return;
        e.preventDefault();
        dispatch(main.modal ? { type: "modal/close" } : { type: "modal/open", modal: { kind: "roomPicker" } });
        return;
      }
      if (!e.altKey || e.ctrlKey || e.metaKey || modalOpen) return;
      // The UI is in a shadow root: `composedPath()[0]` is the focused element, `e.target` is the host element.
      if (isTextField(e.composedPath()[0])) return;
      if (e.code === "KeyN") {
        e.preventDefault();
        // TODO-FINDING alt-shift-n-without-room - Alt+Shift+N sends `sameRoomAs` = the focused panel also when that panel is a picker (no room); without a focused panel it is a plain `panel/new`.
        dispatch(e.shiftKey && focusedPanelId ? { type: "panel/new", sameRoomAs: focusedPanelId } : { type: "panel/new" });
      } else if (e.code === "KeyW" && !e.shiftKey) {
        e.preventDefault();
        // One press, one close: holding the keys would close tab after tab and then the panels too.
        if (e.repeat) return;
        if (focusedPanelId && altWClosesPanel) dispatch({ type: "panel/close", panelId: focusedPanelId });
        else if (focusedPanelId && activeTabId) dispatch({ type: "tab/close", panelId: focusedPanelId, tabId: activeTabId });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch, collapsed, expandButtonVisible, modalOpen, main.modal, main.addAccount, focusedPanelId, activeTabId, altWClosesPanel]);

  // "Also reveal the LeftBar expand button when the mouse reaches the screen edge."
  useEffect(() => {
    if (!collapsed || expandButtonVisible) return;
    const onMouseMove = (e: MouseEvent) => {
      if (e.clientX <= 2) dispatch({ type: "leftBar/revealExpandButton" });
    };
    window.addEventListener("mousemove", onMouseMove);
    return () => window.removeEventListener("mousemove", onMouseMove);
  }, [dispatch, collapsed, expandButtonVisible]);

  const pipItems: PipItem[] = pipWidgetIds(main, narrow).flatMap((widgetId) => {
    const widget = main.widgets[widgetId];
    if (!widget) return [];
    return [{ widgetId, widgetName: widget.widget.name, roomName: roomOf(main, widget.roomId)?.name ?? widget.roomId, devToolsOpen: settings.devTools && !!workspace?.devTools[widgetId]?.open }];
  });

  // Narrow window: only the focused panel is visible, the pager steps through the others.
  const focusedIndex = Math.max(0, panels.findIndex((p) => p.id === focusedPanelId));
  const pagerPanel = panels[focusedIndex];
  // TODO-FINDING pager-picker-label - the pager shows the room name; a panel without a room (picker) has none. "New panel" for now.
  const pagerLabel = pagerPanel?.content.kind === "room" ? (roomOf(main, pagerPanel.content.roomId)?.name ?? pagerPanel.content.roomId) : "New panel";
  const focusPanel = (index: number) => panels[index] && dispatch({ type: "panel/focus", panelId: panels[index].id });

  return (
    <>
      <div className={`app ${fence ? "fence" : ""} ${narrow ? "narrow" : ""} ${fullscreen ? "fullscreen" : ""}`} data-testid="app" inert={main.addAccount ? true : undefined}>
        {!collapsed && <LeftBar leftBar={main.leftBar} devTools={devToolsAvailable(vm)} devBackendActive={fence} sidePanelView={main.sidePanel.view} account={activeAccount(main)} />}
        {narrow && main.sidePanel.view && <div className="scrim side-scrim" data-testid="side-scrim" onClick={() => dispatch({ type: "sidePanel/close" })} />}
        <SidePanel main={main} settings={settings} />
        <RoomsArea main={main} settings={settings} fullscreen={fullscreen} renderWidget={renderWidget} />
        {narrow && panels.length > 1 && (
          <div className="pager" role="group" aria-label="Room panels">
            <IconButton icon="arrowLeft" title="Previous room panel" className="xs" disabled={focusedIndex === 0} onClick={() => focusPanel(focusedIndex - 1)} />
            <span>
              <b>{pagerLabel}</b> · {focusedIndex + 1} of {panels.length}
            </span>
            <IconButton icon="arrowRight" title="Next room panel" className="xs" disabled={focusedIndex === panels.length - 1} onClick={() => focusPanel(focusedIndex + 1)} />
          </div>
        )}
        {collapsed && expandButtonVisible && (
          <button type="button" className="expand-btn" title="Show the left bar" aria-label="Show the left bar" onClick={() => dispatch({ type: "leftBar/expand" })}>
            <Icon name="panelOpen" size={18} />
          </button>
        )}
        {fence && collapsed && (
          // TODO-FINDING floating-dev-badge-covers-header - as in story `app-appshell--dev-backend-collapsed` the badge floats at the top centre, over the room panel headers (in fullscreen: over the tab bar that appears on hover). It lets presses through (`pointer-events: none`), but still hides what is below it.
          <span className="dev-badge">
            <Icon name="cone" size={12} />
            DevBackend
          </span>
        )}
        {workspace && <PipPanel pip={workspace.pip} items={pipItems.slice(0, PIP_VISIBLE_BOXES)} more={pipItems.slice(PIP_VISIBLE_BOXES)} renderWidget={renderWidget} />}
        {/* The live region is always there, so a new toast is announced. */}
        <div className="toasts" role="status">
          {main.toasts.map((toast) => (
            <div key={toast.id} className="toast" data-testid="toast">
              {toastText(toast.text)}
              {/* TODO-FINDING toast-dismiss-button - the designed toast has no dismiss button and does not say when a toast goes away (timeout?). */}
              <IconButton icon="x" title="Dismiss" className="xs" onClick={() => dispatch({ type: "toast/dismiss", id: toast.id })} />
            </div>
          ))}
        </div>
        {main.modal && <Modal modal={main.modal} main={main} />}
      </div>
      {main.addAccount && (
        // TODO-FINDING add-account-overlay - "Add account" is not designed: the login page covers the whole app for now (the designed "Add account" row has the external-link icon, which suggests another flow).
        <div className="login-overlay" data-testid="add-account">
          <LoginView login={main.addAccount} adding />
        </div>
      )}
    </>
  );
}
