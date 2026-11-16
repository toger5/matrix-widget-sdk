/** Shared pieces of the DevBackendView sections (mockup functions `acc`, `sub`, `formChips`, `delayRow`). */
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button, Icon, Toggle } from "../ui/atoms";

/** One accordion section. The body is only rendered while open. */
export function Acc({ id, title, open, count, onToggle, children }: { id: string; title: string; open: boolean; count?: string; onToggle: () => void; children: ReactNode }) {
  return (
    <div className={`acc-sec ${open ? "open" : ""}`} data-section={id}>
      <button type="button" className="acc-sec-h" aria-expanded={open} aria-controls={`devb-sec-${id}`} onClick={onToggle}>
        <Icon name={open ? "chevDown" : "chevRight"} size={14} />
        <span>{title}</span>
        {count ? <em>{count}</em> : null}
      </button>
      {open && (
        <div className="acc-sec-b" id={`devb-sec-${id}`} role="region" aria-label={title}>
          {children}
        </div>
      )}
    </div>
  );
}

export function Sub({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="sub-h">
      <span>{title}</span>
      {children}
    </div>
  );
}

/**
 * The predefined forms of "send state" and "send event" (mockup function `formChips`): a tablist
 * named `label`. Only the selected chip is in the tab order; the arrow keys, Home and End select
 * another one.
 */
export function FormChips<F extends string>({ forms, active, label, onSelect }: { forms: { form: F; label: string }[]; active: F; label: string; onSelect: (form: F) => void }) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const index = forms.findIndex((f) => f.form === active);
    const next = e.key === "ArrowRight" ? index + 1 : e.key === "ArrowLeft" ? index - 1 : e.key === "Home" ? 0 : e.key === "End" ? forms.length - 1 : undefined;
    if (next === undefined) return;
    e.preventDefault();
    const target = (next + forms.length) % forms.length;
    onSelect(forms[target].form);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[target]?.focus();
  };
  return (
    <div className="chips" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {forms.map(({ form, label: text }) => (
        <button key={form} type="button" className={`chip ${form === active ? "on" : ""}`} role="tab" aria-selected={form === active} tabIndex={form === active ? 0 : -1} onClick={() => onSelect(form)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export const pretty = (value: unknown) => JSON.stringify(value, null, 2);

/** Parses the text of a JSON editor. Only objects are accepted (event content, a whole event). */
export function parseJsonObject(text: string): { value: Record<string, unknown> } | { error: string } {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return { error: "The JSON must be an object." };
    return { value: value as Record<string, unknown> };
  } catch (e) {
    return { error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** The editable version of the mockup's `<pre class="code edit">`. */
export function JsonArea({ label, value, onChange, tall = false, autoFocus }: { label: string; value: string; onChange: (text: string) => void; tall?: boolean; autoFocus?: boolean }) {
  const rows = Math.min(14, Math.max(3, value.split("\n").length));
  return <textarea className={`code edit ${tall ? "tall" : ""}`} aria-label={label} spellCheck={false} rows={rows} value={value} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} />;
}

export function FormError({ error }: { error?: string }) {
  return error ? (
    <p className="devb-err" role="alert">
      {error}
    </p>
  ) : null;
}

export interface DelayDraft {
  on: boolean;
  ms: string;
}
export const NO_DELAY: DelayDraft = { on: false, ms: "5000" };

/** `undefined`: send now. An `error` if the delay field is not a number. */
export function delayOf(delay: DelayDraft): { delayMs?: number; error?: string } {
  if (!delay.on) return {};
  const ms = Number(delay.ms);
  if (delay.ms.trim() === "" || !Number.isFinite(ms) || ms < 0) return { error: "The delay must be a number of milliseconds." };
  return { delayMs: ms };
}

/** The last row of a send form: the "Delayed" toggle, the delay in ms while on, and the submit button. */
export function DelayRow({ delay, onChange }: { delay: DelayDraft; onChange: (delay: DelayDraft) => void }) {
  return (
    <div className="inline-row">
      <Toggle on={delay.on} label="Send delayed" onChange={(on) => onChange({ ...delay, on })} />
      <span>Delayed</span>
      {delay.on && (
        <>
          <input className="input mono narrow" aria-label="Delay in milliseconds" inputMode="numeric" value={delay.ms} onChange={(e) => onChange({ ...delay, ms: e.target.value })} />
          <span className="muted">ms</span>
        </>
      )}
      <span className="sp" />
      <Button kind="primary" sm icon={delay.on ? "clock" : "send"} type="submit">
        {delay.on ? "Schedule" : "Send"}
      </Button>
    </div>
  );
}

export const timeOf = (timestamp?: number) => (timestamp === undefined ? "" : new Date(timestamp).toLocaleTimeString("en-GB"));

/** The current time, updated a few times per second while `active` (for countdowns). */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * A popup (listbox or menu) anchored to a trigger: closes on Escape (focus returns to the trigger)
 * and on a press outside; the arrow keys, Home and End move the focus between its buttons.
 */
export function usePopup() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const popup = popupRef.current;
    const first = popup?.querySelector<HTMLElement>('[aria-selected="true"]') ?? popup?.querySelector<HTMLElement>("button");
    first?.focus();
    const onDown = (e: PointerEvent) => {
      const path = e.composedPath();
      if (popup && !path.includes(popup) && !(triggerRef.current && path.includes(triggerRef.current))) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
      return;
    }
    const items = Array.from(popupRef.current?.querySelectorAll<HTMLElement>("button") ?? []);
    if (!items.length) return;
    const root = popupRef.current?.getRootNode() as Document | ShadowRoot | undefined;
    const index = items.indexOf(root?.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? index + 1 : e.key === "ArrowUp" ? index - 1 : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : undefined;
    if (next === undefined) return;
    e.preventDefault();
    items[(next + items.length) % items.length].focus();
  };
  return { open, toggle: () => setOpen((o) => !o), close, triggerRef, popupRef, onKeyDown };
}
