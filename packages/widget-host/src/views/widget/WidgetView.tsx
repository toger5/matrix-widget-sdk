import { useId, useState, type ReactNode } from "react";

import type { PanelId, TabId, WidgetDevToolsLayout, WidgetInstanceViewModel } from "../../appViewModel";
import { useDispatch } from "../env";
import { Avatar, Button, Icon } from "../ui/atoms";
import { WidgetSlot } from "../ui/WidgetSlot";
import { DevTools } from "./DevTools";
import { capabilityLabel } from "./format";

export interface WidgetViewProps {
  widget: WidgetInstanceViewModel;
  /** The layout of this widget's dev tools. `undefined`: dev tools are disabled in the Settings (nothing of them is rendered). */
  devTools?: WidgetDevToolsLayout;
  /** Inside a PiP box: no room for prompts as cards, the dev tool bar is icons only. */
  compact?: boolean;
  /** The tab that shows the widget, for the "Close tab" button of the failed state. */
  tab?: { panelId: PanelId; tabId: TabId };
  /** Story only: what the `WidgetSlot` shows outside the app's shadow root. */
  standIn?: ReactNode;
  /** Story only: the message of the MessagesPanel that starts expanded. */
  initialExpandedMessage?: string;
}

/**
 * One running widget: the WidgetDevToolBar (if open) around the widget itself, which is a
 * `WidgetSlot` plus the loading / failed / prompt states. leaves widgetview/*, devtools/*
 *
 * The slot is always rendered (the iframe must never lose its place); a state that the user has
 * to see or answer is a layer that covers it.
 */
export function WidgetView({ widget, devTools, compact = false, tab, standIn, initialExpandedMessage }: WidgetViewProps) {
  const dev = devTools?.open ? devTools : undefined;
  return (
    <div className={`wv dock-${dev?.dock ?? "none"}`} data-testid="widget-view" data-widget-id={widget.id}>
      {dev && <DevTools widget={widget} layout={dev} initialExpandedMessage={initialExpandedMessage} />}
      <div className="wv-widget">
        <WidgetSlot widgetId={widget.id}>{standIn}</WidgetSlot>
        <WidgetState widget={widget} compact={compact} tab={tab} />
      </div>
    </div>
  );
}

/** What covers the widget: failed, a prompt (capabilities first, then OpenID) or loading. Nothing while it simply runs. */
function WidgetState({ widget, compact, tab }: Pick<WidgetViewProps, "widget" | "compact" | "tab">) {
  const dispatch = useDispatch();
  const widgetId = widget.id;
  const { name, url } = widget.widget;
  const { load, prompts } = widget;
  // TODO-FINDING covered-widget-not-inert - the iframe below a prompt or the failed state stays in the tab order (the view cannot make a slotted iframe inert); the iframe layer should set `inert` while the widget is covered

  if (load.state === "failed") {
    if (compact) {
      // TODO-FINDING compact-failed-state - the mockups have no failed state in a PiP box. The compact form is one line and "Retry"; the error text is only in the tooltip
      return (
        <div className="wv-over compact" data-testid="widget-failed">
          <div className="wv-state" role="alert" title={load.error}>
            <b>{name} could not be loaded</b>
            <Button sm icon="refresh" onClick={() => dispatch({ type: "widget/reload", widgetId })}>
              Retry
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className="wv-over" data-testid="widget-failed">
        <div className="wv-state" role="alert">
          <Icon name="alert" size={30} className="danger" />
          <b>{name} could not be loaded</b>
          <span className="muted">{load.error}</span>
          <code>{url}</code>
          <div className="inline-row">
            <Button kind="primary" icon="refresh" onClick={() => dispatch({ type: "widget/reload", widgetId })}>
              Retry
            </Button>
            {tab && <Button onClick={() => dispatch({ type: "tab/close", panelId: tab.panelId, tabId: tab.tabId })}>Close tab</Button>}
          </div>
        </div>
      </div>
    );
  }

  if (prompts.capabilities || prompts.openId) {
    if (compact) {
      return (
        <div className="wv-over compact" data-testid="widget-prompt">
          <div className="wv-state">
            <b title={name}>{prompts.capabilities ? `${name} asks for permissions` : `${name} asks for an OpenID token`}</b>
            <Button sm kind="primary" onClick={() => dispatch({ type: "widget/jumpToTab", widgetId })}>
              Open to answer
            </Button>
          </div>
        </div>
      );
    }
    // TODO-FINDING two-prompts-order - both prompts can be pending at once; the cards are shown one after the other (capabilities, then OpenID), not stacked
    return (
      <div className="wv-over" data-testid="widget-prompt">
        <div className="wv-state">
          {prompts.capabilities ? (
            // A new request (other capabilities) starts with everything checked again.
            <CapabilityPrompt key={prompts.capabilities.requested.join("\n")} widget={widget} requested={prompts.capabilities.requested} />
          ) : (
            <OpenIdPrompt widget={widget} />
          )}
        </div>
      </div>
    );
  }

  if (load.state === "loading") {
    return (
      <div className={`wv-over ${compact ? "compact" : ""}`} data-testid="widget-loading">
        <div className="wv-state">
          <span className="spinner" role="status" aria-label="Loading" />
          <b>Loading {name}…</b>
          {!compact && <span className="muted">Waiting for the widget to report that it is ready.</span>}
        </div>
      </div>
    );
  }
  return null;
}

/** The permission card: a checklist of the requested capabilities, all checked at first. leaf widgetview/prompt */
function CapabilityPrompt({ widget, requested }: { widget: WidgetInstanceViewModel; requested: string[] }) {
  const dispatch = useDispatch();
  const titleId = useId();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(requested));
  const answer = (approved: string[]) => dispatch({ type: "widget/answerCapabilities", widgetId: widget.id, approved });
  const toggle = (capability: string) => {
    const next = new Set(selected);
    if (!next.delete(capability)) next.add(capability);
    setSelected(next);
  };
  const approved = requested.filter((c) => selected.has(c));

  return (
    <div className="prompt-card" role="group" aria-labelledby={titleId} data-testid="capability-prompt">
      <Avatar name={widget.widget.name} id={widget.widgetKey} size={40} square />
      <b id={titleId}>{widget.widget.name} asks for permissions</b>
      <span className="muted">Choose what this widget may do in this room. Nothing is shared before you approve.</span>
      <div className="perm-list">
        {requested.map((capability) => {
          const on = selected.has(capability);
          const label = capabilityLabel(capability);
          return (
            <label key={capability} className="perm">
              <button type="button" className={`check ${on ? "on" : ""}`} role="checkbox" aria-checked={on} aria-label={label ? `${label} (${capability})` : capability} onClick={() => toggle(capability)}>
                {on && <Icon name="check" size={12} />}
              </button>
              <span>
                {label && <b>{label}</b>}
                {/* TODO-FINDING prompt-capability-text - the mockup shows the capability without side and namespace ("send_event.delayed") on one line; the view shows the full string and lets it wrap, so the card is taller than in leaf widgetview/prompt and scrolls in a small tab */}
                <small className="mono" title={capability}>
                  {capability}
                </small>
              </span>
            </label>
          );
        })}
      </div>
      <div className="inline-row">
        <Button onClick={() => answer([])}>Deny all</Button>
        <span className="sp" />
        {/* TODO-FINDING approve-nothing - with nothing checked "Approve 0 selected" would be the same as "Deny all"; the button is disabled then */}
        <Button kind="primary" disabled={approved.length === 0} onClick={() => answer(approved)}>
          Approve {approved.length} selected
        </Button>
      </div>
    </div>
  );
}

/** The OpenID card. Not in the mockups: it reuses the permission card. */
function OpenIdPrompt({ widget }: { widget: WidgetInstanceViewModel }) {
  const dispatch = useDispatch();
  const titleId = useId();
  const answer = (allow: boolean) => dispatch({ type: "widget/answerOpenId", widgetId: widget.id, allow });
  return (
    <div className="prompt-card" role="group" aria-labelledby={titleId} data-testid="openid-prompt">
      <Avatar name={widget.widget.name} id={widget.widgetKey} size={40} square />
      <b id={titleId}>{widget.widget.name} asks for your identity</b>
      <span className="muted">This widget asks for an OpenID token, which proves your identity to the widget's server.</span>
      <div className="inline-row">
        <Button onClick={() => answer(false)}>Block</Button>
        <span className="sp" />
        <Button kind="primary" icon="key" onClick={() => answer(true)}>
          Allow
        </Button>
      </div>
    </div>
  );
}
