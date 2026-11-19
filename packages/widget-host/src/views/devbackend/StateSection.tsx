/**
 * The body of the State panel of the room dev tools: the filter, "Send state" and the current state
 * by type and key, with an edit button per state event. stories `sidepanel-roomtoolsview--state`,
 * `sidepanel-roomtoolsview--state-form-open`, `sidepanel-devbackendview--state`,
 * `sidepanel-devbackendview-state--*`, `rooms-roomdevtools--*`
 */
import { useMemo, useState } from "react";

import type { MockedStateEvent, RoomId, RoomToolsViewModel } from "../../appViewModel";
import { useDispatch } from "../env";
import { Button, Icon, IconButton, Json } from "../ui/atoms";
import { FormError, JsonArea, parseJsonObject, pretty } from "../ui/forms";
import { PanelTools } from "./parts";
import type { RoomBoxMode } from "./RoomBox";
import { SendStateForm } from "./SendStateForm";

const entryId = (e: { type: string; stateKey: string }) => `${e.type}\u0000${e.stateKey}`;

interface Props {
  /** "account": a real room, where "Add member" would need an invite: not offered. */
  mode: RoomBoxMode;
  roomId: RoomId;
  state: MockedStateEvent[];
  stateForm: RoomToolsViewModel["stateForm"];
  /** The DevBackend user, or the account. */
  userId?: string;
}

export function StateSection({ mode, roomId, state, stateForm, userId }: Props) {
  const dispatch = useDispatch();
  const [filter, setFilter] = useState("");
  const [openTypes, setOpenTypes] = useState<ReadonlySet<string>>(new Set());
  const [openEntry, setOpenEntry] = useState<string>();
  const [editing, setEditing] = useState<{ id: string; text: string; error?: string }>();
  const f = filter.trim().toLowerCase();
  const matching = useMemo(() => state.filter((e) => !f || e.type.toLowerCase().includes(f) || e.stateKey.toLowerCase().includes(f)), [state, f]);
  const types = useMemo(() => {
    const byType = new Map<string, MockedStateEvent[]>();
    for (const e of matching) byType.set(e.type, [...(byType.get(e.type) ?? []), e]);
    return [...byType];
  }, [matching]);
  const toggleType = (type: string) => {
    const next = new Set(openTypes);
    if (!next.delete(type)) next.add(type);
    setOpenTypes(next);
  };
  const saveEdit = (event: MockedStateEvent) => {
    if (!editing) return;
    const content = parseJsonObject(editing.text);
    if ("error" in content) return setEditing({ ...editing, error: content.error });
    dispatch({ type: "roomTools/sendState", roomId, event: { type: event.type, stateKey: event.stateKey, content: content.value } });
    setEditing(undefined);
  };

  return (
    <>
      <PanelTools label="Filter state by type or key" placeholder="Filter by type or key" filter={filter} onFilter={setFilter} shown={matching.length} total={state.length} />
      <div className="rdt-body">
        <SendStateForm mode={mode} roomId={roomId} form={stateForm} state={state} userId={userId} />
        <div className="rdt-list">
          <div className="dt-sub">
            <span>Current state</span>
          </div>
          {types.length === 0 ? (
            <p className="dt-empty">{state.length ? "No state event matches the filter." : "This room has no state yet."}</p>
          ) : (
            <div className="tree">
              {types.map(([type, events]) => {
                const open = openTypes.has(type) || f !== "";
                const single = events.length === 1 && events[0].stateKey === "";
                return (
                  <div key={type} className="tree-group">
                    <button type="button" className="tree-row lvl0" aria-expanded={open} onClick={() => toggleType(type)}>
                      <Icon name={open ? "chevDown" : "chevRight"} size={12} />
                      <span className="mono">{type}</span>
                      {single ? <span className="rdt-p mono">{JSON.stringify(events[0].content)}</span> : <em>{events.length}</em>}
                    </button>
                    {open &&
                      events.map((event) => {
                        const id = entryId(event);
                        const isEditing = editing?.id === id;
                        const shown = openEntry === id || isEditing;
                        const what = `${event.type} ${event.stateKey || "(empty state key)"}`;
                        return (
                          <div key={id} className="tree-group">
                            <div className={`tree-row lvl1 ${shown ? "sel" : ""}`}>
                              <button
                                type="button"
                                className="tree-key mono dt-trunc-start"
                                aria-expanded={shown}
                                aria-label={`State key ${event.stateKey || "(empty)"} of ${event.type}`}
                                title={event.stateKey || undefined}
                                onClick={() => setOpenEntry(shown && !isEditing ? undefined : id)}
                              >
                                {event.stateKey ? <bdi>{event.stateKey}</bdi> : <span className="ph">empty</span>}
                              </button>
                              <IconButton
                                icon="edit"
                                title="Edit this state event"
                                aria-label={`Edit state event ${what}`}
                                className="xs"
                                onClick={() => {
                                  setOpenEntry(id);
                                  setEditing({ id, text: pretty(event.content) });
                                }}
                              />
                            </div>
                            {isEditing ? (
                              <div className="msg-b editor">
                                <div className="editor-h">
                                  <span className="mono">
                                    {event.type} · {event.stateKey || "(empty)"}
                                  </span>
                                  <span className="pill">editing</span>
                                </div>
                                <JsonArea label={`Content of ${what} (JSON)`} value={editing.text} autoFocus onChange={(text) => setEditing({ id, text })} />
                                <FormError error={editing.error} />
                                <div className="inline-row">
                                  <span className="muted">Saving sends a new state event.</span>
                                  <span className="sp" />
                                  <Button sm onClick={() => setEditing(undefined)}>
                                    Cancel
                                  </Button>
                                  <Button kind="primary" sm onClick={() => saveEdit(event)}>
                                    Save
                                  </Button>
                                </div>
                              </div>
                            ) : shown ? (
                              <div className="msg-b">
                                <pre className="code">
                                  <Json value={event.content} />
                                </pre>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
