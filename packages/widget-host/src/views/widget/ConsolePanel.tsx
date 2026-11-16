import { useState } from "react";

import type { WidgetDevToolsData, WidgetInstanceId } from "../../appViewModel";
import { useDispatch } from "../env";
import { Button, Icon } from "../ui/atoms";
import { clock } from "./format";

type Line = WidgetDevToolsData["console"][number];
const LEVELS: Line["level"][] = ["log", "info", "warn", "error"];

export interface ConsolePanelProps {
  widgetId: WidgetInstanceId;
  lines: Line[];
}

/** WidgetDevToolConsolePanel: the widget's own console, as forwarded by the widget SDK / compat wrapper. leaf devtools/console */
export function ConsolePanel({ widgetId, lines }: ConsolePanelProps) {
  const dispatch = useDispatch();
  const [filter, setFilter] = useState("");
  const [levels, setLevels] = useState<ReadonlySet<Line["level"]>>(() => new Set(LEVELS));
  const needle = filter.trim().toLowerCase();
  const shown = lines.filter((l) => levels.has(l.level) && (!needle || l.text.toLowerCase().includes(needle)));

  const toggleLevel = (level: Line["level"]) => {
    const next = new Set(levels);
    if (!next.delete(level)) next.add(level);
    setLevels(next);
  };

  return (
    <>
      <div className="dt-tools">
        <label className="input search sm">
          <Icon name="search" size={11} />
          <input className="dt-in" type="search" placeholder="Filter" aria-label="Filter console lines" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
        {LEVELS.map((level) => (
          <button key={level} type="button" className={`chip sm ${levels.has(level) ? "on" : ""}`} aria-pressed={levels.has(level)} onClick={() => toggleLevel(level)}>
            {level}
          </button>
        ))}
        <span className="sp" />
        <span className="muted">forwarded by the widget SDK</span>
        <Button sm onClick={() => dispatch({ type: "devTools/clear", widgetId, what: "console" })}>
          Clear
        </Button>
      </div>
      <div className="console" role="log" aria-label="Widget console" data-testid="devtools-console">
        {lines.length === 0 && (
          <p className="dt-empty">
            <b>No console output.</b> The host cannot read the console of a widget (it is a cross-origin iframe). The widget must forward its logs: the widget SDK and the compat wrapper do that.
          </p>
        )}
        {lines.length > 0 && shown.length === 0 && <p className="dt-empty">No line matches the filter.</p>}
        {shown.map((l, i) => (
          <div key={`${l.timestamp}-${i}`} className={`cl ${l.level}`}>
            <span className="cl-l">{l.level}</span>
            <span className="cl-t">{clock(l.timestamp)}</span>
            <span className="cl-m" title={l.text}>
              {l.text}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
