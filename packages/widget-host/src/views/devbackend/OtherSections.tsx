/** The "Widget host behavior" and "To-device messages" sections (mockup functions `behaviorSection`, `toDeviceSection`). leaves devbackend/behavior, devbackend/todevice */
import { useState, type FormEvent } from "react";

import type { RoomId, ToDeviceMessage, WidgetHostBehavior } from "../../appViewModel";
import { useDispatch } from "../env";
import { Button, Field, Json, Toggle } from "../ui/atoms";
import { FormError, JsonArea, Sub, parseJsonObject, timeOf } from "./parts";

const BEHAVIORS: { key: keyof WidgetHostBehavior; label: string; hint: string }[] = [
  { key: "autoApproveCapabilities", label: "Auto-approve capabilities", hint: "Grant everything a widget asks for, without the prompt." },
  { key: "autoApproveOpenId", label: "Auto-approve OpenID tokens", hint: "Answer get_openid without asking." },
  { key: "rememberCapabilities", label: "Remember capabilities", hint: "Off: a widget asks again every time it starts." },
  { key: "failSends", label: "Fail sends", hint: "Every send from a widget is answered with an error." },
];

export function BehaviorSection({ roomId, behavior }: { roomId: RoomId; behavior?: WidgetHostBehavior }) {
  const dispatch = useDispatch();
  return (
    <>
      {BEHAVIORS.map(({ key, label, hint }) => (
        <div key={key} className="set-row">
          <div>
            <b>{label}</b>
            <small>{hint}</small>
          </div>
          <Toggle on={behavior?.[key] ?? false} label={label} onChange={(on) => dispatch({ type: "mock/setBehavior", roomId, behavior: { [key]: on } })} />
        </div>
      ))}
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
