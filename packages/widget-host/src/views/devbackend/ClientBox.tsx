/**
 * The Client Backend Tool (mockup functions `clientBox`, `behaviorSection`, `toDeviceSection`): what
 * the mocked rooms share, in collapsible sections. leaves devbackend/behavior, devbackend/todevice
 */
import { useState, type FormEvent } from "react";

import type { MockedRoomData, RoomToolsSection, ToDeviceMessage, WidgetHostBehavior } from "../../appViewModel";
import { useDispatch } from "../env";
import { Button, Field, Json, Toggle } from "../ui/atoms";
import { FormError, JsonArea, parseJsonObject } from "../ui/forms";
import { Acc, Sub, timeOf } from "./parts";
import { ToolBox } from "./ToolBox";

export function ClientBox({ openSections, heightShare, behavior, data }: { openSections: RoomToolsSection[]; heightShare: number; behavior: WidgetHostBehavior; data: MockedRoomData }) {
  const dispatch = useDispatch();
  const isOpen = (section: RoomToolsSection) => openSections.includes(section);
  const toggle = (section: RoomToolsSection) => () => dispatch({ type: "roomTools/toggleSection", section });
  return (
    <ToolBox tool="client" heightShare={heightShare} className="devb">
      <Acc id="widgetHostBehavior" title="Widget host behavior" open={isOpen("widgetHostBehavior")} onToggle={toggle("widgetHostBehavior")}>
        <BehaviorSection behavior={behavior} failSends={data.failSends} />
      </Acc>
      <Acc id="toDevice" title="To-device messages" open={isOpen("toDevice")} count={String(data.toDevice.length)} onToggle={toggle("toDevice")}>
        <ToDeviceSection toDevice={data.toDevice} userId={data.userId} />
      </Acc>
    </ToolBox>
  );
}

const BEHAVIORS: { key: keyof WidgetHostBehavior; label: string; hint: string }[] = [
  { key: "autoApproveCapabilities", label: "Auto-approve capabilities", hint: "Grant everything a widget asks for, without the prompt." },
  { key: "rememberCapabilities", label: "Remember capabilities", hint: "Off: a widget asks again every time it starts." },
];

/** How the host answers widgets (`WidgetHostBehavior`), and "fail sends", which the DevBackend does. */
export function BehaviorSection({ behavior, failSends }: { behavior: WidgetHostBehavior; failSends: boolean }) {
  const dispatch = useDispatch();
  const row = (label: string, hint: string, on: boolean, onChange: (on: boolean) => void) => (
    <div key={label} className="set-row">
      <div>
        <b>{label}</b>
        <small>{hint}</small>
      </div>
      <Toggle on={on} label={label} onChange={onChange} />
    </div>
  );
  return (
    <>
      {BEHAVIORS.map(({ key, label, hint }) => row(label, hint, behavior[key], (on) => dispatch({ type: "mock/setBehavior", behavior: { [key]: on } })))}
      {row("Fail sends", "Every send from a widget is answered with an error.", failSends, (on) => dispatch({ type: "mock/setFailSends", on }))}
    </>
  );
}

export function ToDeviceSection({ toDevice, userId = "" }: { toDevice: ToDeviceMessage[]; userId?: string }) {
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
      <Sub title="Send to the widget's device" />
      <form className="form" aria-label="Send to-device message" onSubmit={submit}>
        <Field label="Type">
          <input className="input mono" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} />
        </Field>
        {/* TODO-FINDING devbackend-todevice-sender - the mockup has one "Sender" select (user · device); `ToDeviceMessage` has `userId` and `deviceId` without saying whose they are. For now two text fields, meaning the sender for a message to the widget. */}
        <Field label="User ID">
          <input className="input mono" value={draft.userId} onChange={(e) => setDraft({ ...draft, userId: e.target.value })} />
        </Field>
        <Field label="Device ID">
          <input className="input mono" value={draft.deviceId} onChange={(e) => setDraft({ ...draft, deviceId: e.target.value })} />
        </Field>
        <JsonArea label="To-device content (JSON)" value={draft.content} onChange={(content) => setDraft({ ...draft, content })} />
        <FormError error={error} />
        <div className="inline-row">
          <Toggle on={draft.encrypted} label="Mark as encrypted" onChange={(encrypted) => setDraft({ ...draft, encrypted })} />
          <span>Mark as encrypted</span>
          <span className="sp" />
          <Button kind="primary" sm icon="send" type="submit">
            Send
          </Button>
        </div>
      </form>

      <Sub title="Messages">
        <em className="count">{toDevice.length}</em>
      </Sub>
      <div className="ev-list" role="list" aria-label="To-device messages">
        {toDevice.map((message, index) => {
          const open = expanded === index;
          const fromWidget = message.direction === "fromWidget";
          return (
            <div key={index} className="ev-item" role="listitem">
              <button type="button" className="ev" aria-expanded={open} onClick={() => setExpanded(open ? undefined : index)}>
                <span className="mono ev-t">{message.type}</span>
                <span className="ev-time">{timeOf(message.timestamp)}</span>
                <span className="ev-p">
                  {fromWidget ? "to" : "from"} {message.userId} · {message.deviceId}
                </span>
                <span className="ev-s">
                  <span className="pill">{fromWidget ? "from widget" : "to widget"}</span>
                  {message.encrypted && <span className="pill">encrypted</span>}
                </span>
              </button>
              {open && (
                <pre className="code">
                  <Json value={message.content} />
                </pre>
              )}
            </div>
          );
        })}
        {toDevice.length === 0 && <p className="hint">No to-device messages yet.</p>}
      </div>
    </>
  );
}
