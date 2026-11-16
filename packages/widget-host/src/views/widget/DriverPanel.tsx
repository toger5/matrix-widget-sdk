import { useState, type FormEvent, type ReactNode } from "react";

import type { WidgetDevToolsData, WidgetInstanceId } from "../../appViewModel";
import { useDispatch } from "../env";
import { Button, IconButton } from "../ui/atoms";
import { splitCapability } from "./format";

export interface DriverPanelProps {
  widgetId: WidgetInstanceId;
  capabilities: WidgetDevToolsData["capabilities"];
}

/** A two-option segmented control (radio group) in the look of the mockup's `.seg`. */
function Seg<T extends string>({ label, options, value, onChange }: { label: string; options: readonly T[]; value: T; onChange: (value: T) => void }) {
  return (
    <span className="seg sm" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={o === value} onClick={() => onChange(o)}>
          <span className={o === value ? "on" : ""}>{o}</span>
        </button>
      ))}
    </span>
  );
}

function Cap({ capability, denied, children }: { capability: string; denied?: boolean; children?: ReactNode }) {
  const { side, name } = splitCapability(capability);
  return (
    <div className={`cap ${denied ? "denied" : ""}`} role="listitem" data-capability={capability}>
      <span className={`cap-side ${side === "host" ? "host" : ""}`}>{side || "?"}</span>
      <span className="cap-n" title={capability}>
        {name}
      </span>
      {children}
    </div>
  );
}

/** WidgetDevToolDriverPanel: the capabilities the driver holds, and buttons that mock a host action. leaf devtools/driver */
export function DriverPanel({ widgetId, capabilities }: DriverPanelProps) {
  const dispatch = useDispatch();
  const { approved, autoApproved, denied } = capabilities;
  const [draft, setDraft] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [language, setLanguage] = useState("de");
  const [visibility, setVisibility] = useState<"visible" | "hidden">("visible");

  const add = (e: FormEvent) => {
    e.preventDefault();
    const capability = draft.trim();
    if (!capability) return;
    dispatch({ type: "devTools/grantCapability", widgetId, capability });
    setDraft("");
  };
  const revoke = (capability: string) => (
    <IconButton icon="x" title="Revoke this capability" className="xs" onClick={() => dispatch({ type: "devTools/revokeCapabilities", widgetId, capabilities: [capability] })} />
  );

  return (
    <div className="driver" data-testid="devtools-driver">
      <div className="dt-sub">
        <span>
          Approved capabilities <em>{approved.length}</em>
        </span>
        <Button sm disabled={approved.length + autoApproved.length === 0} onClick={() => dispatch({ type: "devTools/revokeCapabilities", widgetId, capabilities: "all" })}>
          Revoke all
        </Button>
      </div>
      <div className="caps" role="list" aria-label="Approved capabilities">
        {approved.length === 0 && <p className="dt-empty">The widget holds no capability that you approved.</p>}
        {approved.map((c) => (
          <Cap key={c} capability={c}>
            {revoke(c)}
          </Cap>
        ))}
      </div>
      {autoApproved.length > 0 && (
        <>
          <div className="dt-sub">
            <span>
              Auto-approved <em>{autoApproved.length}</em>
            </span>
          </div>
          <div className="caps" role="list" aria-label="Auto-approved capabilities">
            {/* TODO-FINDING revoke-auto-approved - can an auto-approved capability be revoked? The host would approve it again on the next request. For now it has the same revoke button as an approved one, and "Revoke all" includes it */}
            {autoApproved.map((c) => (
              <Cap key={c} capability={c}>
                <span className="pill">auto</span>
                {revoke(c)}
              </Cap>
            ))}
          </div>
        </>
      )}
      {denied.length > 0 && (
        <>
          <div className="dt-sub">
            <span>
              Denied <em>{denied.length}</em>
            </span>
          </div>
          <div className="caps" role="list" aria-label="Denied capabilities">
            {denied.map((c) => (
              <Cap key={c} capability={c} denied>
                <span className="pill">denied</span>
                <Button sm aria-label={`Approve ${c}`} onClick={() => dispatch({ type: "devTools/grantCapability", widgetId, capability: c })}>
                  Approve
                </Button>
              </Cap>
            ))}
          </div>
        </>
      )}
      <form className="cap-add" onSubmit={add}>
        <label className="input mono sm">
          <input className="dt-in" placeholder="widget:org.matrix.mscXXXX.…" aria-label="Add capability" spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)} />
        </label>
        <Button sm icon="plus" type="submit" disabled={!draft.trim()}>
          Add
        </Button>
      </form>

      <div className="dt-sub">
        <span>Mock a host action</span>
      </div>
      {/* TODO: more mock host actions follow (appDesign.md: "just add a couple for now"). */}
      <div className="mock-acts">
        <Button sm icon="sun" onClick={() => dispatch({ type: "devTools/mockHostAction", widgetId, action: "updateTheme", value: theme })}>
          Update theme
        </Button>
        <Seg label="Theme to send" options={["dark", "light"] as const} value={theme} onChange={setTheme} />
        <Button sm icon="globe" onClick={() => dispatch({ type: "devTools/mockHostAction", widgetId, action: "updateLanguage", value: language.trim() })} disabled={!language.trim()}>
          Update language
        </Button>
        <label className="input mono sm narrow">
          <input className="dt-in" aria-label="Language to send" spellCheck={false} value={language} onChange={(e) => setLanguage(e.target.value)} />
        </label>
        <Button sm icon="eye" onClick={() => dispatch({ type: "devTools/mockHostAction", widgetId, action: "updateVisibility", value: String(visibility === "visible") })}>
          Update visibility
        </Button>
        <Seg label="Visibility to send" options={["visible", "hidden"] as const} value={visibility} onChange={setVisibility} />
      </div>
    </div>
  );
}
