/** The "State" section of a mocked room (mockup functions `stateSection`, `stateTree`). leaves devbackend/state, devbackend/state-element-call, devbackend/state-raw, devbackend/state-edit */
import { useMemo, useState, type FormEvent } from "react";

import type { DevBackendViewModel, MockedStateEvent, RoomId } from "../../appViewModel";
import { useDispatch } from "../env";
import { Button, Field, Icon, IconButton, Json } from "../ui/atoms";
import { FormError, JsonArea, parseJsonObject, pretty } from "../ui/forms";
import { Sub } from "./parts";
import { SendStateForm } from "./SendStateForm";

type Shortcut = "name" | "topic" | "member";
const SHORTCUTS: Record<Shortcut, { button: string; label: string; save: string }> = {
  name: { button: "Edit name", label: "Room name", save: "Save" },
  topic: { button: "Edit description", label: "Description", save: "Save" },
  member: { button: "Add member", label: "User ID", save: "Add" },
};

const entryId = (e: { type: string; stateKey: string }) => `${e.type}\u0000${e.stateKey}`;

interface Props {
  roomId: RoomId;
  state: MockedStateEvent[];
  stateForm: DevBackendViewModel["stateForm"];
  /** The DevBackend user. */
  userId?: string;
}

export function StateSection({ roomId, state, stateForm, userId }: Props) {
  const dispatch = useDispatch();
  const send = (event: MockedStateEvent) => dispatch({ type: "mock/sendState", roomId, event });
  const contentOf = (type: string, stateKey = "") => state.find((e) => e.type === type && e.stateKey === stateKey)?.content;

  // --- shortcuts
  const [shortcut, setShortcut] = useState<{ kind: Shortcut; value: string; error?: string }>();
  const openShortcut = (kind: Shortcut) => {
    if (shortcut?.kind === kind) return setShortcut(undefined);
    const current = kind === "name" ? contentOf("m.room.name")?.name : kind === "topic" ? contentOf("m.room.topic")?.topic : "";
    setShortcut({ kind, value: typeof current === "string" ? current : "" });
  };
  const submitShortcut = (e: FormEvent) => {
    e.preventDefault();
    if (!shortcut) return;
    const value = shortcut.value.trim();
    if (shortcut.kind === "member") {
      if (!/^@[^:\s]+:\S+$/.test(value)) return setShortcut({ ...shortcut, error: "A user ID looks like @user:server." });
      // TODO-FINDING devbackend-add-member-content - "add member" sends only { membership: "join" }; a display name or avatar needs "send state" or the edit button.
      send({ type: "m.room.member", stateKey: value, content: { membership: "join" } });
    } else if (shortcut.kind === "name") send({ type: "m.room.name", stateKey: "", content: { name: value } });
    else send({ type: "m.room.topic", stateKey: "", content: { topic: value } });
    setShortcut(undefined);
  };

  // --- current state
  const [filter, setFilter] = useState("");
  const [openTypes, setOpenTypes] = useState<ReadonlySet<string>>(new Set());
  const [openEntry, setOpenEntry] = useState<string>();
  const [editing, setEditing] = useState<{ id: string; text: string; error?: string }>();
  const types = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const byType = new Map<string, MockedStateEvent[]>();
    for (const e of state) {
      if (f && !e.type.toLowerCase().includes(f) && !e.stateKey.toLowerCase().includes(f)) continue;
      byType.set(e.type, [...(byType.get(e.type) ?? []), e]);
    }
    return [...byType];
  }, [state, filter]);
  const toggleType = (type: string) => {
    const next = new Set(openTypes);
    if (!next.delete(type)) next.add(type);
    setOpenTypes(next);
  };
  const saveEdit = (event: MockedStateEvent) => {
    if (!editing) return;
    const content = parseJsonObject(editing.text);
    if ("error" in content) return setEditing({ ...editing, error: content.error });
    send({ type: event.type, stateKey: event.stateKey, content: content.value });
    setEditing(undefined);
  };

  return (
    <>
      <Sub title="Shortcuts" />
      <div className="chips">
        {(Object.keys(SHORTCUTS) as Shortcut[]).map((kind) => (
          <Button key={kind} sm icon={kind === "member" ? "userPlus" : "edit"} aria-expanded={shortcut?.kind === kind} onClick={() => openShortcut(kind)}>
            {SHORTCUTS[kind].button}
          </Button>
        ))}
      </div>
      {shortcut && (
        <form className="form" aria-label={SHORTCUTS[shortcut.kind].button} onSubmit={submitShortcut}>
          <Field label={SHORTCUTS[shortcut.kind].label}>
            <input
              className={`input ${shortcut.kind === "member" ? "mono" : ""}`}
              autoFocus
              placeholder={shortcut.kind === "member" ? "@user:dev.local" : undefined}
              value={shortcut.value}
              onChange={(e) => setShortcut({ kind: shortcut.kind, value: e.target.value })}
              onKeyDown={(e) => e.key === "Escape" && setShortcut(undefined)}
            />
          </Field>
          <FormError error={shortcut.error} />
          <div className="inline-row">
            <span className="sp" />
            <Button sm onClick={() => setShortcut(undefined)}>
              Cancel
            </Button>
            <Button kind="primary" sm type="submit">
              {SHORTCUTS[shortcut.kind].save}
            </Button>
          </div>
        </form>
      )}

      <SendStateForm roomId={roomId} form={stateForm} state={state} userId={userId} />

      <Sub title="Current state">
        <label className="input search sm">
          <Icon name="search" size={12} />
          <input aria-label="Filter state by type or key" placeholder="Filter by type or key" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
      </Sub>
      <div className="tree">
        {types.map(([type, events]) => {
          const open = openTypes.has(type) || filter.trim() !== "";
          return (
            <div key={type} className="tree-group">
              <button type="button" className="tree-row lvl0" aria-expanded={open} onClick={() => toggleType(type)}>
                <Icon name={open ? "chevDown" : "chevRight"} size={12} />
                <span className="mono">{type}</span>
                <em>{events.length}</em>
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
                        <button type="button" className="tree-key mono" aria-expanded={shown} aria-label={`State key ${event.stateKey || "(empty)"} of ${event.type}`} onClick={() => setOpenEntry(shown && !isEditing ? undefined : id)}>
                          {event.stateKey || <span className="ph">empty</span>}
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
                        <div className="editor">
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
                        <pre className="code">
                          <Json value={event.content} />
                        </pre>
                      ) : null}
                    </div>
                  );
                })}
            </div>
          );
        })}
        {types.length === 0 && <p className="hint">{state.length ? "No state event matches the filter." : "This room has no state yet."}</p>}
      </div>
    </>
  );
}
