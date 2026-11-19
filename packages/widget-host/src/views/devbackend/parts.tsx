/**
 * Shared pieces of the room dev tools' panels and the DevBackend's tool boxes (the send form's
 * disclosure and form menu, the filter row, the delay row, text cut at its start). The form pieces
 * other views use too are in `../ui/forms`.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button, Check, Icon } from "../ui/atoms";

/** Text cut at its start, so its distinguishing end stays ("…msc3401.call.member"); the full text is the `title`. */
export const Front = ({ className, text }: { className: string; text: string }) => (
  <span className={`${className} dt-trunc-start`} title={text}>
    <bdi>{text}</bdi>
  </span>
);

/** A user ID in a row: the localpart, then the server (faint, dropped in a narrow list); the full ID is the `title`. */
export function UserId({ id }: { id: string }) {
  const at = id.indexOf(":");
  return (
    <span className="rdt-s" title={id}>
      {at < 0 ? id : id.slice(0, at)}
      {at >= 0 && <i>{id.slice(at)}</i>}
    </span>
  );
}

/** The toolbar of a panel: the filter and how many rows it shows ("10 of 12"). */
export function PanelTools({ label, placeholder, filter, onFilter, shown, total }: { label: string; placeholder: string; filter: string; onFilter: (filter: string) => void; shown: number; total: number }) {
  return (
    <div className="dt-tools">
      <label className="input search sm">
        <Icon name="search" size={12} />
        <input className="dt-in" type="search" aria-label={label} placeholder={placeholder} value={filter} onChange={(e) => onFilter(e.target.value)} />
      </label>
      <span className="muted">
        {shown} of {total}
      </span>
    </div>
  );
}

/** An entry of the form menu of a send form. */
export interface FormMenuItem<F extends string> {
  form: F;
  label: string;
  /** Starts a group: a separator before it. */
  group?: boolean;
}

/**
 * The send form of a panel: a disclosure heading ("Send state") with the menu of its forms; open, the
 * form below it (at most 45% of the panel), or in a panel of 520px or more a column left of the list
 * (CSS). Choosing a form opens it.
 */
export function Compose<F extends string>({
  name,
  open,
  onOpen,
  forms,
  active,
  onSelect,
  children,
}: {
  name: string;
  open: boolean;
  onOpen: (open: boolean) => void;
  forms: FormMenuItem<F>[];
  active: F;
  onSelect: (form: F) => void;
  children: ReactNode;
}) {
  const menu = usePopup();
  const current = forms.find((f) => f.form === active) ?? forms[0];
  const menuName = `${name} form`;
  return (
    <section className={`rdt-compose ${open ? "open" : ""}`} aria-label={name}>
      <div className="dt-sub">
        <button type="button" className="dt-disc" aria-expanded={open} onClick={() => onOpen(!open)}>
          <Icon name={open ? "chevDown" : "chevRight"} size={12} />
          <span>{name}</span>
        </button>
        <span className="rdt-menu">
          {/* The markup of `Button sm end="chevDown"`, which takes no ref. */}
          <button ref={menu.triggerRef} type="button" className="btn sm" aria-haspopup="menu" aria-expanded={menu.open} aria-label={`${menuName}, ${current.label}`} title={`${name}: choose what to send`} onClick={menu.toggle}>
            <span>{current.label}</span>
            <Icon name="chevDown" size={14} className="end" />
          </button>
          {menu.open && (
            <div ref={menu.popupRef} className="dropdown" role="menu" aria-label={menuName} onKeyDown={menu.onKeyDown}>
              {forms.map((f) => (
                <div key={f.form} style={{ display: "contents" }}>
                  {f.group && <div className="dd-sep" />}
                  <button
                    type="button"
                    className={`dd-row ${f.form === current.form ? "on" : ""}`}
                    role="menuitemradio"
                    aria-checked={f.form === current.form}
                    onClick={() => {
                      menu.close();
                      onSelect(f.form);
                      onOpen(true);
                    }}
                  >
                    <span>{f.label}</span>
                    {f.form === current.form && <Icon name="check" size={13} className="end" />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </span>
      </div>
      {open && <div className="rdt-compose-b">{children}</div>}
    </section>
  );
}

/** A section of a tool box (`.dt-sub`): a disclosure heading, with a count. */
export function ToolSection({ title, open, count, onToggle }: { title: string; open: boolean; count?: number; onToggle: () => void }) {
  return (
    <div className="dt-sub" data-section={title}>
      <button type="button" className="dt-disc" aria-expanded={open} onClick={onToggle}>
        <Icon name={open ? "chevDown" : "chevRight"} size={12} />
        <span>{title}</span>
      </button>
      {count !== undefined && <em>{count}</em>}
    </div>
  );
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

/**
 * The last row of a send form: the "Delayed" checkbox, the delay in ms while on, and the submit
 * button. `update`: the form replaces a widget the room has, the button reads "Update widget"
 * ("Schedule update") in the warning look.
 */
export function DelayRow({ delay, onChange, update = false }: { delay: DelayDraft; onChange: (delay: DelayDraft) => void; update?: boolean }) {
  return (
    <div className="inline-row">
      <Check on={delay.on} label="Send delayed" onChange={(on) => onChange({ ...delay, on })} />
      <span>Delayed</span>
      {delay.on && (
        <>
          <input className="input mono narrow" aria-label="Delay in milliseconds" inputMode="numeric" value={delay.ms} onChange={(e) => onChange({ ...delay, ms: e.target.value })} />
          <span className="muted">ms</span>
        </>
      )}
      <span className="sp" />
      <Button kind={update ? "warning" : "primary"} sm icon={update ? "alert" : delay.on ? "clock" : "send"} type="submit">
        {update ? (delay.on ? "Schedule update" : "Update widget") : delay.on ? "Schedule" : "Send"}
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
    const first = popup?.querySelector<HTMLElement>('[aria-selected="true"], [aria-checked="true"]') ?? popup?.querySelector<HTMLElement>("button");
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
