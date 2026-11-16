import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import { activeWorkspace, type MainViewModel, type PanelId, type RoomId, type SettingsViewModel, type TabId, type TabViewModel } from "../../appViewModel";
import type { RoomSummary } from "../../session";
import { useDispatch } from "../env";
import { localWidgetsOf, roomWidgets } from "../helpers";
import { Avatar, Icon, initials } from "../ui/atoms";
import { roomTabDomId, tabDomId, tabInfo, tabPanelDomId, type TabInfo } from "./tabInfo";

export interface TabBarProps {
  main: MainViewModel;
  settings: SettingsViewModel;
  panelId: PanelId;
  roomId: RoomId;
  /** `undefined` while the rooms load: the room name tab shows `roomName` without counts, widget names come from the running widgets only. */
  room: RoomSummary | undefined;
  /** The room name tab, and the name of the tab list ("Tabs of Design crit"). */
  roomName: string;
  /** The tabs after the room name: widgets and the timeline. */
  tabs: TabViewModel[];
  /** `undefined` (or a tab that does not exist): the room name is selected. */
  activeTabId?: TabId;
  /** The header hides the tabs until it is hovered or has the focus inside: the room name is the tab stop then. */
  fullscreen?: boolean;
}

/** Room for the fade at the end of an overflowing tab bar: the active tab is scrolled clear of it. */
const FADE = 36;

/**
 * The tab bar of a room panel, rendered into its header: the room name (the first tab, it shows the
 * RoomOverview), the tabs of widgets and the timeline, the + button and, when the tabs do not fit,
 * the "all tabs" button with its menu. leaves roomview/header, tabs/*. ARIA tabs pattern: the tab is
 * a button, its ⋯ (dev tools, widget tabs only) and × buttons are siblings; the tablist wrapper is
 * `display: contents`, so only the tabs after the room name (`.tabs`) scroll.
 */
export function TabBar({ main, settings, panelId, roomId, room, roomName, tabs, activeTabId, fullscreen = false }: TabBarProps) {
  const dispatch = useDispatch();
  const devTools = activeWorkspace(main)?.devTools ?? {};
  const tablistRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const allRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ overflowing: false, scrolled: false, atEnd: false });
  const [menuOpen, setMenuOpen] = useState(false);

  // TODO-FINDING tab-overflow-threshold - tabs first shrink to their minimum width (88px, label with an ellipsis); only when they still do not fit, the bar switches to "overflowing" (full-width tabs that scroll, fade, "all tabs" button). The mockups do not say when the switch happens.
  const measure = () => {
    const el = listRef.current;
    if (!el) return;
    const next = {
      overflowing: el.scrollWidth > el.clientWidth + 1,
      scrolled: el.scrollLeft > 1,
      atEnd: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
    };
    setOverflow((o) => (o.overflowing === next.overflowing && o.scrolled === next.scrolled && o.atEnd === next.atEnd ? o : next));
  };
  // After every render (a tab was added, renamed, got its buttons) and whenever the bar is resized.
  useLayoutEffect(measure);
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Keep the active tab in view, clear of the fade.
  useLayoutEffect(() => {
    const el = listRef.current;
    const tab = el?.querySelector<HTMLElement>(".tab.active");
    if (!el || !tab || !overflow.overflowing) return;
    const list = el.getBoundingClientRect();
    const box = tab.getBoundingClientRect();
    if (box.left < list.left + 2) el.scrollLeft -= list.left + 2 - box.left;
    else if (box.right > list.right - FADE) el.scrollLeft += box.right - (list.right - FADE);
  }, [activeTabId, overflow.overflowing, tabs.length]);

  useEffect(() => {
    if (!overflow.overflowing) setMenuOpen(false);
  }, [overflow.overflowing]);

  // The menu: focus the checked entry when it opens; a press outside closes it.
  useEffect(() => {
    if (!menuOpen) return;
    const menu = menuRef.current;
    (menu?.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu?.querySelector<HTMLElement>('[role="menuitemradio"]'))?.focus();
    const onPointerDown = (e: PointerEvent) => {
      const path = e.composedPath();
      if (!path.includes(menuRef.current as EventTarget) && !path.includes(allRef.current as EventTarget)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [menuOpen]);

  // A tab closed with the keyboard (Delete, or its × pressed with Enter or Space) takes the focus
  // with it: it goes to the tab that followed, else to the one before (ARIA tabs pattern). The
  // room name is the first tab, so there always is one.
  const focusAfterClose = useRef<{ tabId: TabId; index: number } | undefined>(undefined);
  useLayoutEffect(() => {
    const pending = focusAfterClose.current;
    if (!pending || tabs.some((t) => t.id === pending.tabId)) return;
    focusAfterClose.current = undefined;
    const all = tablistRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [];
    all[Math.min(pending.index, all.length - 1)]?.focus();
  }, [tabs]);
  const closeFromKeyboard = (tab: TabViewModel) => {
    // Its index among the `[role="tab"]` elements, after the room name.
    focusAfterClose.current = { tabId: tab.id, index: tabs.indexOf(tab) + 1 };
    dispatch({ type: "tab/close", panelId, tabId: tab.id });
  };

  const closeMenu = (refocus: boolean) => {
    setMenuOpen(false);
    if (refocus) allRef.current?.focus();
  };

  /** Arrow keys move the focus between the tabs, the room name first; Enter or Space (the button) activates; Delete closes a tab other than the room name (the focus moves on: `focusAfterClose`). */
  // TODO-FINDING tab-arrow-keys-manual-activation - arrow keys only move the focus, they do not activate the tab ("manual activation" of the ARIA tabs pattern): activating a tab moves widgets in and out of the PiP panel, which is too much for a key that is used to walk through the tabs. appDesign.md says "arrow keys switch".
  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, tab?: TabViewModel) => {
    const all = Array.from(tablistRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
    const i = all.indexOf(e.currentTarget);
    const to = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: all.length - 1 }[e.key];
    if (to !== undefined) {
      e.preventDefault();
      const target = all[(to + all.length) % all.length];
      target?.focus();
      target?.scrollIntoView({ block: "nearest", inline: "nearest" });
    } else if (e.key === "Delete" && tab) {
      e.preventDefault();
      closeFromKeyboard(tab);
    }
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    const i = Math.max(0, items.indexOf(e.target as HTMLElement));
    const to = { ArrowUp: i - 1, ArrowDown: i + 1, Home: 0, End: items.length - 1 }[e.key];
    if (to !== undefined) {
      e.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
    } else if (e.key === "Tab") {
      closeMenu(false);
    }
  };

  const roomSelected = !tabs.some((t) => t.id === activeTabId);
  // The tab that can be reached with the Tab key: the active tab, else the room name (also while
  // the fullscreen header hides the tabs).
  const tabStop = roomSelected || fullscreen ? undefined : activeTabId;
  // Alt+W closes the shown tab while the panel has a tab, else the panel (`hasTab`).
  const altWClosesTab = tabs.length > 0;
  const widgetCount = roomWidgets(room, localWidgetsOf(main, roomId)).length;

  return (
    <>
      <div ref={tablistRef} className="rp-tabs" role="tablist" aria-label={`Tabs of ${roomName}`}>
        <button
          type="button"
          className={`room-chip ${roomSelected ? "active" : ""}`}
          role="tab"
          id={roomTabDomId(panelId)}
          aria-selected={roomSelected}
          aria-controls={roomSelected ? tabPanelDomId(panelId) : undefined}
          tabIndex={tabStop === undefined ? 0 : -1}
          aria-label={roomName}
          title={`${roomName} · open the room overview`}
          data-room-id={roomId}
          onClick={() => dispatch({ type: "tab/showOverview", panelId })}
          onKeyDown={(e) => onTabKeyDown(e)}
        >
          <Avatar name={roomName} id={roomId} size={24} square mxc={room?.avatarUrl} />
          <span className="room-name">{roomName}</span>
          {room && (
            <span className="room-counts">
              {room.widgetEvents !== undefined && (
                <span title={`${widgetCount} ${widgetCount === 1 ? "widget" : "widgets"}`}>
                  <Icon name="grid" size={12} />
                  {widgetCount}
                </span>
              )}
              {room.memberCount !== undefined && (
                <span title={`${room.memberCount} ${room.memberCount === 1 ? "member" : "members"}`}>
                  <Icon name="users" size={12} />
                  {room.memberCount}
                </span>
              )}
            </span>
          )}
        </button>
        <span className="rp-div" />
        <div
          ref={listRef}
          className={`tabs ${overflow.overflowing ? "overflowing" : ""} ${overflow.scrolled ? "scrolled" : ""} ${overflow.atEnd ? "at-end" : ""}`}
          data-testid="tab-bar"
          onScroll={measure}
        >
          {tabs.map((tab) => {
            const info = tabInfo(main, room, tab, roomName);
            const active = tab.id === activeTabId;
            const widgetId = tab.kind === "widget" ? tab.widgetId : undefined;
            const devOpen = widgetId !== undefined && !!devTools[widgetId]?.open;
            const close = () => dispatch({ type: "tab/close", panelId, tabId: tab.id });
            return (
              <div
                key={tab.id}
                className={`tab ${tab.kind} ${active ? "active" : ""} ${info.pinned ? "pinned" : ""}`}
                // the padding around the button belongs to the tab as well
                onClick={(e) => e.target === e.currentTarget && dispatch({ type: "tab/activate", panelId, tabId: tab.id })}
                // middle click closes; without the default (autoscroll)
                onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                onAuxClick={(e) => {
                  if (e.button !== 1) return;
                  e.preventDefault();
                  close();
                }}
              >
                <button
                  type="button"
                  className="tab-main"
                  role="tab"
                  id={tabDomId(panelId, tab.id)}
                  aria-selected={active}
                  aria-controls={active ? tabPanelDomId(panelId) : undefined}
                  tabIndex={tab.id === tabStop ? 0 : -1}
                  title={info.title}
                  data-tab-id={tab.id}
                  data-widget-id={widgetId}
                  onClick={() => dispatch({ type: "tab/activate", panelId, tabId: tab.id })}
                  onKeyDown={(e) => onTabKeyDown(e, tab)}
                >
                  <TabIcon info={info} size={16} iconSize={15} />
                  <span className="tab-label">{info.name}</span>
                  {info.load === "loading" && (
                    <>
                      <span className="spinner tab-state" aria-hidden="true" />
                      <span className="vh">, loading</span>
                    </>
                  )}
                  {info.load === "failed" && (
                    <>
                      <Icon name="alert" size={13} className="tab-state danger" />
                      <span className="vh">, failed to load</span>
                    </>
                  )}
                  {info.pinned && (
                    <>
                      <span className="tab-pin">
                        <Icon name="pin" size={13} />
                      </span>
                      <span className="vh">, always on screen</span>
                    </>
                  )}
                </button>
                {/* ⋯ and × are shown on the active tab; on the others they appear on hover and keyboard focus (CSS). */}
                {/* TODO-FINDING inactive-tab-buttons-overlay - on an inactive tab the buttons lie over the end of the label (no layout shift on hover). An inactive tab with open dev tools keeps its ⋯ visible and reserves 22px for the ×, so it is wider than in leaf tabs/overview-active. */}
                {/* TODO-FINDING tab-reorder-not-implemented - `tab/move` exists, but dragging a tab is not drawn and not built. */}
                {/* TODO-FINDING widget-avatar-initials - the mockups label widget avatars with two letters ("WB"); `initials("Whiteboard")` gives "W", and the hue comes from the widget key, not from the mockup. Widgets have no avatar URL in the view model. */}
                {settings.devTools && widgetId !== undefined && (
                  <button
                    type="button"
                    className={`tab-btn ${devOpen ? "on" : ""}`}
                    title={`Dev tools of ${info.name}`}
                    aria-label={`Dev tools of ${info.name}`}
                    aria-pressed={devOpen}
                    onClick={() => dispatch({ type: "devTools/toggle", widgetId })}
                  >
                    <Icon name="dots" size={14} />
                  </button>
                )}
                <button
                  type="button"
                  className="tab-btn tab-close"
                  title={active && altWClosesTab ? `${info.closeLabel} (Alt+W)` : info.closeLabel}
                  aria-label={info.closeLabel}
                  // `detail` 0: pressed with Enter or Space, not clicked
                  onClick={(e) => (e.detail === 0 ? closeFromKeyboard(tab) : close())}
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {/* The + selects the room name, whose RoomOverview opens widgets. */}
      <button type="button" className="ibtn tab-add" title="Open a widget" aria-label="Open a widget" onClick={() => dispatch({ type: "tab/showOverview", panelId })}>
        <Icon name="plus" />
      </button>
      {overflow.overflowing && (
        <button
          ref={allRef}
          type="button"
          className={`ibtn tab-all ${menuOpen ? "on" : ""}`}
          // TODO-FINDING all-tabs-button-name - the accessible name is the mockup's "All N tabs" (it changes with the number of tabs; N counts the tabs after the room name, which never scrolls away); tests should match /^All \d+ tabs$/.
          title={`All ${tabs.length} tabs`}
          aria-label={`All ${tabs.length} tabs`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" || menuOpen) return;
            e.preventDefault();
            setMenuOpen(true);
          }}
        >
          <Icon name="chevDown" />
        </button>
      )}
      {overflow.overflowing && menuOpen && (
        <div ref={menuRef} className="dropdown tab-menu" role="menu" aria-label={`All tabs of ${roomName}`} onKeyDown={onMenuKeyDown}>
          {tabs.map((tab) => {
            const info = tabInfo(main, room, tab, roomName);
            const active = tab.id === activeTabId;
            return (
              <button
                key={tab.id}
                type="button"
                className={`dd-row ${active ? "on" : ""}`}
                role="menuitemradio"
                aria-checked={active}
                tabIndex={-1}
                data-tab-id={tab.id}
                onClick={() => {
                  dispatch({ type: "tab/activate", panelId, tabId: tab.id });
                  closeMenu(true);
                }}
              >
                <TabIcon info={info} size={18} iconSize={16} />
                <span>
                  <b>{info.name}</b>
                </span>
                {info.pinned && (
                  <>
                    <Icon name="pin" size={12} />
                    <span className="vh">, always on screen</span>
                  </>
                )}
                {active && <Icon name="check" size={14} className="end" />}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

/** The widget's avatar, or the message icon of the timeline tab (a host tab). */
function TabIcon({ info, size, iconSize }: { info: TabInfo; size: number; iconSize: number }) {
  if (info.widgetKey === undefined) return <Icon name="message" size={iconSize} className="tab-ico" />;
  return <Avatar name={info.name} id={info.widgetKey} size={size} square label={initials(info.name)} />;
}
