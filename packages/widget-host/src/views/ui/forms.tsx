/**
 * Pieces of the forms of several views: the DevBackendView's send forms and editors, and "Add
 * widget" of the RoomOverview (the chips of the predefined forms, the `.code.edit` JSON editor,
 * the error line of a form).
 */
import type { KeyboardEvent } from "react";

/**
 * The predefined forms of "send state", "send event" and "Add widget": a tablist
 * named `label`. Only the selected chip is in the tab order; the arrow keys, Home and End select
 * another one.
 */
export function FormChips<F extends string>({ forms, active, label, onSelect }: { forms: { form: F; label: string }[]; active: F; label: string; onSelect: (form: F) => void }) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
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

/** The editable version of the design's `<pre class="code edit">`. */
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
