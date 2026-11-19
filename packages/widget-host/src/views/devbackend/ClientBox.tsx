/**
 * The Client Backend Tool: what the mocked rooms share, in collapsible sections (disclosure
 * headings), in the look of the room dev tools. Stories `sidepanel-devbackendview-tools--behavior`,
 * `sidepanel-devbackendview-tools--to-device`.
 */
import { useState, type FormEvent } from "react";

import type { MockedRoomData, RoomToolsSection, ToDeviceMessage, WidgetHostBehavior } from "../../appViewModel";
import { useDispatch } from "../env";
import { Button, Check, Field, Icon, Json } from "../ui/atoms";
import { FormError, JsonArea, parseJsonObject } from "../ui/forms";
import { ToolSection, timeOf } from "./parts";
import { ToolBox } from "./ToolBox";

export function ClientBox({ openSections, heightShare, behavior, data }: { openSections: RoomToolsSection[]; heightShare: number; behavior: WidgetHostBehavior; data: MockedRoomData }) {
  const dispatch = useDispatch();
  const isOpen = (section: RoomToolsSection) => openSections.includes(section);
  const toggle = (section: RoomToolsSection) => () => dispatch({ type: "roomTools/toggleSection", section });
  return (
    <ToolBox tool="client" heightShare={heightShare} className="devb">
      <ToolSection title="Widget host behavior" open={isOpen("widgetHostBehavior")} onToggle={toggle("widgetHostBehavior")} />
      {isOpen("widgetHostBehavior") && <BehaviorSection behavior={behavior} failSends={data.failSends} />}
      <ToolSection title="To-device messages" open={isOpen("toDevice")} count={data.toDevice.length} onToggle={toggle("toDevice")} />
      {isOpen("toDevice") && <ToDeviceSection toDevice={data.toDevice} userId={data.userId} />}
    </ToolBox>
  );
}

const BEHAVIORS: { key: keyof WidgetHostBehavior; label: string; hint: string }[] = [
  { key: "autoApproveCapabilities", label: "Auto-approve capabilities", hint: "grant everything without the prompt" },
  { key: "rememberCapabilities", label: "Remember capabilities", hint: "off: asks again at every start" },
];

/** How the host answers widgets (`WidgetHostBehavior`), and "fail sends", which the DevBackend does: a checkbox row each. */
function BehaviorSection({ behavior, failSends }: { behavior: WidgetHostBehavior; failSends: boolean }) {
  const dispatch = useDispatch();
  const row = (label: string, hint: string, on: boolean, onChange: (on: boolean) => void) => (
    <div key={label} className="rdt-opt" title={hint}>
      <Check on={on} label={label} onChange={onChange} />
      <b>{label}</b>
      <small>{hint}</small>
    </div>
  );
  return (
    <div role="group" aria-label="Widget host behavior">
      {BEHAVIORS.map(({ key, label, hint }) => row(label, hint, behavior[key], (on) => dispatch({ type: "mock/setBehavior", behavior: { [key]: on } })))}
      {row("Fail sends", "every send of a widget gets an error", failSends, (on) => dispatch({ type: "mock/setFailSends", on }))}
    </div>
  );
}

function ToDeviceSection({ toDevice, userId = "" }: { toDevice: ToDeviceMessage[]; userId?: string }) {
  const dispatch = useDispatch();
  const [draft, setDraft] = useState({ type: "", userId, deviceId: "", encrypted: true, content: "{}" });
  const [error, setError] = useState<string>();
  const [expanded, setExpanded] = useState<number>();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const content = parseJsonObject(draft.content);
    const problem = !draft.type.trim() ? "The event type is missing." : !draft.userId.trim() ? "The user ID is missing." : !draft.deviceId.trim() ? "The device ID is missing." : "error" in content ? content.error : undefined;
    setError(problem);
    if (problem || "error" in content) return;
    dispatch({ type: "mock/sendToDevice", message: { type: draft.type.trim(), userId: draft.userId.trim(), deviceId: draft.deviceId.trim(), encrypted: draft.encrypted, content: content.value } });
  };

  return (
    <>
      <form className="form" aria-label="Send to-device message" onSubmit={submit}>
        <Field label="Type">
          <input className="input mono" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} />
        </Field>
        {/* TODO-FINDING devbackend-todevice-sender - the design has one "Sender" select (user · device); `ToDeviceMessage` has `userId` and `deviceId` without saying whose they are. For now two text fields, meaning the sender for a message to the widget. */}
        <Field label="User ID">
          <input className="input mono" value={draft.userId} onChange={(e) => setDraft({ ...draft, userId: e.target.value })} />
        </Field>
        <Field label="Device ID">
          <input className="input mono" value={draft.deviceId} onChange={(e) => setDraft({ ...draft, deviceId: e.target.value })} />
        </Field>
        <JsonArea label="To-device content (JSON)" value={draft.content} onChange={(content) => setDraft({ ...draft, content })} />
        <FormError error={error} />
        <div className="inline-row">
          <Check on={draft.encrypted} label="Mark as encrypted" onChange={(encrypted) => setDraft({ ...draft, encrypted })} />
          <span>Encrypted</span>
          <span className="sp" />
          <Button kind="primary" sm icon="send" type="submit">
            Send
          </Button>
        </div>
      </form>
      <div role="list" aria-label="To-device messages">
        {toDevice.map((message, index) => {
          const open = expanded === index;
          const fromWidget = message.direction === "fromWidget";
          const who = `${message.userId} · ${message.deviceId}`;
          return (
            <div key={index} className={`msg ${open ? "open" : ""}`} role="listitem">
              <button type="button" className="msg-h" aria-expanded={open} onClick={() => setExpanded(open ? undefined : index)}>
                <Icon name={open ? "chevDown" : "chevRight"} size={11} />
                <span className={`msg-dir ${fromWidget ? "from" : "to"}`} role="img" aria-label={fromWidget ? "from the widget" : "to the widget"} title={fromWidget ? "Sent by the widget" : "Sent to the widget"}>
                  {fromWidget ? "W→H" : "H→W"}
                </span>
                <span className="rdt-t">{message.type}</span>
                <span className="rdt-s" title={`${fromWidget ? "to" : "from"} ${who}`}>
                  {message.userId.split(":")[0]}
                </span>
                {message.encrypted && (
                  <span title="encrypted">
                    <Icon name="lock" size={11} />
                    <span className="vh">, encrypted</span>
                  </span>
                )}
                <span className="msg-time">{timeOf(message.timestamp)}</span>
              </button>
              {open && (
                <div className="msg-b">
                  <pre className="code">
                    <Json value={message.content} />
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {toDevice.length === 0 && <p className="dt-empty">No to-device messages yet.</p>}
    </>
  );
}
