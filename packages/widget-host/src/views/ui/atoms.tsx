/**
 * The atoms every view (and every sketch story) is built from, styled by the design rules
 * `src/styles/atoms.css` (and the app-only `atoms.css` next to this file). Story `ui-atoms--atoms`
 * shows them all.
 */
import { useEffect, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";

import { useViewEnv } from "../env";
import { ICONS, type IconName } from "./icons";

export type { IconName };

export function Icon({ name, size = 16, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={`ico ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

/** The app icon: a widget (filled box) inside a host (outlined box). */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="7" y="10" width="10" height="7" rx="2" fill="currentColor" />
      <circle cx="8" cy="6.6" r="1.1" fill="currentColor" />
      <circle cx="11.5" cy="6.6" r="1.1" fill="currentColor" />
    </svg>
  );
}

export const initials = (name: string) =>
  name
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

/** A stable hue (0..359) for an id or a name, for avatars without an image. */
export function hueOf(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash % 360;
}

interface AvatarProps {
  /** Used for the initials and, without `id`, for the color. */
  name: string;
  /** What the color is derived from (a user id, room id or widget key), so a rename keeps the color. */
  id?: string;
  size?: number;
  /** Rooms and widgets are rounded squares, users are round. */
  square?: boolean;
  /** Overrides the initials. */
  label?: string;
  /** An `mxc://` URI; shown instead of the initials once `ViewEnv.avatar` has resolved it. */
  mxc?: string;
}

/** A user (round) or room/widget (rounded square) avatar: the image if there is one, else initials on a color. */
export function Avatar({ name, id, size = 28, square = false, label, mxc }: AvatarProps) {
  const { avatar } = useViewEnv();
  const [url, setUrl] = useState<string | undefined>();
  useEffect(() => {
    setUrl(undefined);
    if (!mxc) return;
    let cancelled = false;
    void avatar(mxc).then((u) => !cancelled && setUrl(u));
    return () => {
      cancelled = true;
    };
  }, [avatar, mxc]);
  const style = { "--s": `${size}px`, "--h": hueOf(id ?? name) } as CSSProperties;
  if (url) return <img className={`av ${square ? "sq" : ""}`} style={{ ...style, objectFit: "cover" }} src={url} alt="" />;
  return (
    <span className={`av ${square ? "sq" : ""}`} style={style} aria-hidden="true">
      {label ?? initials(name)}
    </span>
  );
}

/** The DevBackend's "avatar": the cone on the dev color. */
export function DevAvatar({ size = 28 }: { size?: number }) {
  return (
    <span className="av dev-av" style={{ "--s": `${size}px` } as CSSProperties} aria-hidden="true">
      <Icon name="cone" size={Math.round(size * 0.55)} />
    </span>
  );
}

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title">;

/** An icon-only button. `title` is both the tooltip and the accessible name. */
export function IconButton({ icon, title, size = 16, className = "", ...rest }: ButtonProps & { icon: IconName; title: string; size?: number }) {
  return (
    <button type="button" className={`ibtn ${className}`} title={title} aria-label={title} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  );
}

interface BtnProps extends ButtonProps {
  /** `warning`: the action replaces something that exists (e.g. "Update widget"). */
  kind?: "primary" | "danger" | "warning" | "ghost" | "";
  sm?: boolean;
  block?: boolean;
  icon?: IconName;
  /** An icon after the label. */
  end?: IconName;
  title?: string;
  children: ReactNode;
}

export function Button({ kind = "", sm, block, icon, end, className = "", children, ...rest }: BtnProps) {
  return (
    <button type="button" className={`btn ${kind} ${sm ? "sm" : ""} ${block ? "block" : ""} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={14} />}
      <span>{children}</span>
      {end && <Icon name={end} size={14} className="end" />}
    </button>
  );
}

export function Toggle({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" className={`toggle ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}>
      <i />
    </button>
  );
}

/** A checkbox (`.check`): the dev tools' options ("Delayed", "Start reached", the DevBackend's behavior). */
export function Check({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" className={`check ${on ? "on" : ""}`} role="checkbox" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}>
      {on && <Icon name="check" size={11} />}
    </button>
  );
}

/** A labelled control: `<label class="field"><span class="field-l">…</span>{children}</label>`. Give the child `className="input"`. */
export function Field({ label, className = "", children }: { label: ReactNode; className?: string; children: ReactNode }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-l">{label}</span>
      {children}
    </label>
  );
}

/** Pretty-printed, lightly highlighted JSON (keys `.jk`, strings `.js`). `bigint`s are printed as numbers. */
export function Json({ value }: { value: unknown }) {
  const text = JSON.stringify(value, (_, v: unknown) => (typeof v === "bigint" ? Number(v) : v), 2) ?? "undefined";
  const parts: ReactNode[] = [];
  let last = 0;
  const strings = /("(?:[^"\\]|\\.)*")(\s*:)?/g;
  for (let m = strings.exec(text); m; m = strings.exec(text)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <span key={m.index} className={m[2] ? "jk" : "js"}>
        {m[1]}
      </span>,
    );
    if (m[2]) parts.push(m[2]);
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}
