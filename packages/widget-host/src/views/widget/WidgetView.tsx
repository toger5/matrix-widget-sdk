import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import { approveBlockedUntil, CAPABILITY_APPROVE_DELAY_MS, type CapabilityPromptViewModel, type PanelId, type TabId, type WidgetDevToolsLayout, type WidgetInstanceViewModel } from "../../appViewModel";
import { useDispatch, useViewEnv } from "../env";
import { Avatar, Button, Icon } from "../ui/atoms";
import { WidgetSlot } from "../ui/WidgetSlot";
import { DevTools } from "./DevTools";
import type { StatsSeries } from "./StatsPanel";
import { capabilityLabel, capabilityRisk, capabilitySections, capabilitySummary, type CapabilitySection } from "./format";

export interface WidgetViewProps {
  widget: WidgetInstanceViewModel;
  /** The layout of this widget's dev tools. `undefined`: dev tools are disabled in the Settings (nothing of them is rendered). */
  devTools?: WidgetDevToolsLayout;
  /** Inside a PiP box: no room for prompts as cards, the dev tool bar is icons only. */
  compact?: boolean;
  /** The tab that shows the widget, for the "Close tab" button of the failed state. */
  tab?: { panelId: PanelId; tabId: TabId };
  /** Story only: the message of the MessagesPanel that starts expanded. */
  initialExpandedMessage?: string;
  /** Story only: the graph the StatsPanel shows first. */
  initialStatsSeries?: StatsSeries;
  /** Story only: the capabilities the permission card starts with unchecked. */
  initialUnchecked?: string[];
  /** Story only: the one-use capabilities the permission card starts with set to "Always". */
  initialAlways?: string[];
}

/**
 * One running widget: the WidgetDevToolBar (if open) around the widget itself, which is a
 * `WidgetSlot` plus the loading / failed / prompt states. leaves widgetview/*, devtools/*
 *
 * The slot is always rendered (the iframe must never lose its place); a state that the user has
 * to see or answer is a layer that covers it.
 */
export function WidgetView({ widget, devTools, compact = false, tab, initialExpandedMessage, initialStatsSeries, initialUnchecked, initialAlways }: WidgetViewProps) {
  const { widgetStandIn } = useViewEnv();
  const dev = devTools?.open ? devTools : undefined;
  return (
    <div className={`wv dock-${dev?.dock ?? "none"}`} data-testid="widget-view" data-widget-id={widget.id}>
      {dev && <DevTools widget={widget} layout={dev} initialExpandedMessage={initialExpandedMessage} initialStatsSeries={initialStatsSeries} />}
      <div className="wv-widget">
        <WidgetSlot widgetId={widget.id}>{widgetStandIn?.(widget, compact)}</WidgetSlot>
        <WidgetState widget={widget} compact={compact} tab={tab} initialUnchecked={initialUnchecked} initialAlways={initialAlways} />
      </div>
    </div>
  );
}

/** What covers the widget: failed, the capability prompt or loading. Nothing while it simply runs. */
function WidgetState({ widget, compact, tab, initialUnchecked, initialAlways }: Pick<WidgetViewProps, "widget" | "compact" | "tab" | "initialUnchecked" | "initialAlways">) {
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

  if (prompts.capabilities) {
    if (compact) {
      return (
        <div className="wv-over compact" data-testid="widget-prompt">
          <div className="wv-state">
            <b title={name}>{name} asks for permissions</b>
            <Button sm kind="primary" onClick={() => dispatch({ type: "widget/jumpToTab", widgetId })}>
              Open to answer
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className="wv-over" data-testid="widget-prompt">
        <div className="wv-state wv-prompt">
          {/* Keyed by the widget: a request that joins the open card keeps what the user unchecked or set to "Always". */}
          <CapabilityPrompt key={widgetId} widget={widget} prompt={prompts.capabilities} initialUnchecked={initialUnchecked} initialAlways={initialAlways} />
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

/**
 * The permission card: a summary, the capabilities in sections (all checked at first) and
 * "Approve", which is blocked for a moment after the card appeared or a request added to it.
 * Capabilities that a later request added are marked "New"; one the host grants for one use has
 * "Once" / "Always". leaves widgetview/prompt, widgetview/prompt-long, widgetview/prompt-merged,
 * widgetview/prompt-openid
 */
function CapabilityPrompt({ widget, prompt, initialUnchecked = [], initialAlways = [] }: { widget: WidgetInstanceViewModel; prompt: CapabilityPromptViewModel; initialUnchecked?: string[]; initialAlways?: string[] }) {
  const dispatch = useDispatch();
  const id = useId();
  const approveRef = useRef<HTMLButtonElement>(null);
  const { requested, added, unknown, singleUse } = prompt;
  const name = widget.widget.name;
  // What the user unchecked: whatever joins later arrives checked, and earlier choices stay.
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(() => new Set(initialUnchecked));
  const on = (capability: string) => !unchecked.has(capability);
  const check = (capabilities: string[], checked: boolean) =>
    setUnchecked((old) => {
      const next = new Set(old);
      for (const capability of capabilities) if (checked) next.delete(capability);
      else next.add(capability);
      return next;
    });
  // The one-use capabilities set to "Always"; "Once" is the default.
  const [always, setAlways] = useState<ReadonlySet<string>>(() => new Set(initialAlways));
  const setLifetime = (capability: string, value: boolean) =>
    setAlways((old) => {
      const next = new Set(old);
      if (value) next.add(capability);
      else next.delete(capability);
      return next;
    });
  const approved = requested.filter(on);
  const sections = capabilitySections(requested, unknown);
  const answer = (capabilities: string[]) =>
    dispatch({ type: "widget/answerCapabilities", widgetId: widget.id, approved: capabilities, always: capabilities.filter((c) => singleUse.includes(c) && always.has(c)) });

  const until = approveBlockedUntil(prompt);
  const left = useTimeLeft(until);
  const blocked = left > 0;
  // Stories set the block far into the future: the countdown never shows more than the delay.
  const seconds = Math.min(CAPABILITY_APPROVE_DELAY_MS / 1000, Math.ceil(left / 1000));
  const elapsed = Math.max(0, Math.min(1, 1 - left / CAPABILITY_APPROVE_DELAY_MS));
  // The bar under the blocked button fills up until "Approve" can be pressed.
  useEffect(() => {
    const button = approveRef.current;
    const ms = until - Date.now();
    if (!button || ms <= 0 || typeof button.animate !== "function" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const from = Math.max(0, 1 - ms / CAPABILITY_APPROVE_DELAY_MS) * 100;
    const animation = button.animate([{ width: `${from}%` }, { width: "100%" }], { pseudoElement: "::after", duration: ms, easing: "linear", fill: "forwards" });
    return () => animation.cancel();
  }, [until]);

  const section = (s: CapabilitySection) => {
    const n = s.capabilities.filter(on).length;
    const all = n === s.capabilities.length ? true : n === 0 ? false : "mixed";
    return (
      <div key={s.id} className="pc-sec" role="group" aria-labelledby={`${id}-${s.id}`}>
        <div className="pc-sh">
          <Check checked={all} label={`All in ${s.title}`} onToggle={() => check(s.capabilities, all !== true)} />
          <b id={`${id}-${s.id}`}>{s.title}</b>
          {s.risky && <Risk text="Has risky permissions" />}
          <small>
            {n} of {s.capabilities.length}
          </small>
        </div>
        {s.id === "other" && <p className="pc-note">This app does not act on these.</p>}
        {s.capabilities.map((capability) => {
          // What the driver does not know gets no label, even if its name looks familiar.
          const label = s.id === "other" ? undefined : capabilityLabel(capability);
          const risk = s.id === "other" ? undefined : capabilityRisk(capability);
          const isNew = added.includes(capability);
          const pill = isNew && <em className="pill new">New</em>;
          return (
            <label key={capability} className={`perm ${isNew ? "new" : ""}`}>
              <Check checked={on(capability)} label={label ? `${label} (${capability})` : capability} onToggle={() => check([capability], !on(capability))} />
              <span>
                {label ? (
                  <span className="pc-l">
                    <b>{label}</b>
                    {risk && <Risk text={risk} />}
                    {pill}
                  </span>
                ) : (
                  isNew && <span className="pc-l">{pill}</span>
                )}
                <small className="mono">{capability}</small>
                {singleUse.includes(capability) && <Lifetime name={label ?? capability} enabled={on(capability)} always={always.has(capability)} onChange={(value) => setLifetime(capability, value)} />}
              </span>
            </label>
          );
        })}
      </div>
    );
  };

  return (
    <div className="prompt-card caps" role="group" aria-labelledby={`${id}-t`} aria-describedby={`${id}-s`} data-testid="capability-prompt">
      <div className="pc-head">
        <Avatar name={name} id={widget.widgetKey} size={32} square />
        <div>
          <b id={`${id}-t`}>{name} asks for permissions</b>
          <p className="pc-sum" id={`${id}-s`}>
            {capabilitySummary(name, sections).map((part, i) => (part.bold ? <b key={i}>{part.text}</b> : part.text))}
          </p>
        </div>
      </div>
      <div className="pc-body">{sections.map(section)}</div>
      <div className="pc-foot">
        {blocked && (
          <p className="pc-status" role="status" id={`${id}-wait`}>
            <Icon name="clock" size={14} />
            <span>
              {added.length > 0 && `${added.length} ${added.length === 1 ? "permission was" : "permissions were"} added. `}
              You can approve in <b>{seconds} s</b>.
            </span>
          </p>
        )}
        <div className="inline-row">
          <Button onClick={() => answer([])}>Deny all</Button>
          <span className="sp" />
          {/* TODO-FINDING approve-nothing - with nothing checked "Approve 0 selected" would be the same as "Deny all"; the button is disabled then */}
          <button
            ref={approveRef}
            type="button"
            className="btn primary pc-approve"
            disabled={approved.length === 0}
            aria-disabled={blocked || undefined}
            aria-describedby={blocked ? `${id}-wait` : undefined}
            style={blocked ? ({ "--wait": `${elapsed * 100}%` } as CSSProperties) : undefined}
            onClick={() => !blocked && answer(approved)}
          >
            <span>Approve {approved.length} selected</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** A checkbox of the permission card: a button, so that it can be "mixed". */
function Check({ checked, label, onToggle }: { checked: boolean | "mixed"; label: string; onToggle: () => void }) {
  return (
    <button type="button" className={`check ${checked === true ? "on" : checked === "mixed" ? "on mixed" : ""}`} role="checkbox" aria-checked={checked} aria-label={label} onClick={onToggle}>
      {checked === true && <Icon name="check" size={12} />}
      {checked === "mixed" && <Icon name="minus" size={12} />}
    </button>
  );
}

const LIFETIMES = [
  { always: false, label: "Once", title: "For the next use only: the widget asks again after it" },
  { always: true, label: "Always", title: "Whenever the widget asks, without asking you" },
] as const;

/**
 * "Once" / "Always" of a capability the host grants for one use: a radio group, disabled while its
 * row is unchecked; the arrow keys move the selection. It is inside the row's <label>: a click on
 * a radio does not reach the label (it is interactive content), and a click on the group around
 * them is cancelled here, so it never toggles the row.
 */
function Lifetime({ name, enabled, always, onChange }: { name: string; enabled: boolean; always: boolean; onChange: (always: boolean) => void }) {
  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    onChange(!always);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[always ? 0 : 1]?.focus();
  };
  return (
    <span className="seg sm pc-life" role="radiogroup" aria-label={`${name}: once or always`} aria-disabled={!enabled || undefined} onClick={(e) => e.preventDefault()} onKeyDown={onKeyDown}>
      {LIFETIMES.map((o) => {
        const on = o.always === always;
        return (
          <button key={o.label} type="button" className={on ? "on" : ""} role="radio" aria-checked={on} tabIndex={on ? 0 : -1} title={o.title} disabled={!enabled} onClick={() => onChange(o.always)}>
            {o.label}
          </button>
        );
      })}
    </span>
  );
}

/** The warning icon of a risky capability or section. */
function Risk({ text }: { text: string }) {
  return (
    <span className="pc-risk" role="img" aria-label={text} title={text}>
      <Icon name="alert" size={13} />
    </span>
  );
}

/** Milliseconds until `until` (0 once it passed). Re-renders at every whole second left and when it passes. */
function useTimeLeft(until: number): number {
  const [, setTick] = useState(0);
  const left = Math.max(0, until - Date.now());
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setTick((n) => n + 1), left % 1000 || 1000);
    return () => clearTimeout(timer);
  });
  return left;
}
