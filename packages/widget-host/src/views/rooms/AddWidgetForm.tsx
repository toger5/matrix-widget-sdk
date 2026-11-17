/**
 * "Add widget" of the RoomOverview: a form at the top of the
 * Widgets card. Where the definition comes from (the chips: a test widget, the widget form,
 * Element Call, a pasted state event) is separate from where it goes ("Add to": only in this host, or the room).
 * The draft is view state. stories `rooms-roomoverview--add-widget*`, `rooms-addwidgetform--*`
 */
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";

import type { RoomId, WidgetWriteViewModel } from "../../appViewModel";
import type { StateEvent } from "../../widgetStateEvent";
import { useDispatch, useViewEnv } from "../env";
import {
  ElementCallFields,
  NEW_ELEMENT_CALL,
  TestWidgetFields,
  WidgetFields,
  buildElementCallEvent,
  buildTestWidgetEvent,
  buildWidgetEvent,
  freeWidgetId,
  newTestWidgetDraft,
  newWidgetDraft,
  parseWidgetEvent,
  widgetDraftOf,
  type ElementCallDraft,
  type TestWidgetDraft,
  type WidgetDraft,
} from "../forms/widgetForms";
import { Button, Icon } from "../ui/atoms";
import { FormChips, JsonArea } from "../ui/forms";

type AddForm = "testWidget" | "widget" | "elementCall" | "json";
export type AddWidgetTarget = "local" | "room";

const FORMS: { form: AddForm; label: string }[] = [
  { form: "testWidget", label: "Test widget" },
  { form: "widget", label: "Widget" },
  { form: "elementCall", label: "Element Call" },
  { form: "json", label: "Paste JSON" },
];

const TARGETS: { target: AddWidgetTarget; label: string; hint: string }[] = [
  { target: "local", label: "Only in this host", hint: "Only you see it, in this browser. Nothing is sent to the room." },
  { target: "room", label: "The room", hint: "Sent to the room as a state event: everyone in it sees the widget. Changing the room's widgets needs permission." },
];

export interface AddWidgetDraft {
  form: AddForm;
  target: AddWidgetTarget;
  testWidget: TestWidgetDraft;
  widget: WidgetDraft;
  call: ElementCallDraft;
  /** The text of "Paste JSON". */
  json: string;
}

export interface AddWidgetFormProps {
  roomId: RoomId;
  /** The room's widget state events: a write to the room is done once its event is among them. */
  roomEvents: StateEvent[];
  /** The room's local widgets. With `roomEvents`, they give the first free widget ID. */
  localEvents: StateEvent[];
  /** Editing this local widget: no chips and no "Add to", event type and widget ID fixed, "Save". */
  edit?: StateEvent;
  /** `MainViewModel.widgetWrite`, if it is about this room: "Adding…", or why the room refused it. */
  write?: WidgetWriteViewModel;
  /** The active account's user: `creatorUserId` of a legacy widget. */
  userId?: string;
  /** The draft to start with (stories). */
  initial?: Partial<AddWidgetDraft>;
  onClose: () => void;
}

/** Content compared regardless of key order: the room may hand the event back with its keys sorted. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) => (typeof v === "object" && v !== null && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
const sameEvent = (a: StateEvent, b: StateEvent) => a.type === b.type && a.state_key === b.state_key && canonical(a.content) === canonical(b.content);

/** The error box of the form (`.form-err`): a title and the reason. */
function FormRefusal({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="form-err" role="alert">
      <Icon name="alert" size={14} />
      <span>
        {title}
        <small>{reason}</small>
      </span>
    </div>
  );
}

/** "Add to": a radio group in the look of `.seg`; the arrow keys move the selection. */
function TargetSeg({ target, onChange }: { target: AddWidgetTarget; onChange: (target: AddWidgetTarget) => void }) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const index = (TARGETS.findIndex((t) => t.target === target) + step + TARGETS.length) % TARGETS.length;
    onChange(TARGETS[index].target);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus();
  };
  return (
    <div className="field">
      <span className="field-l">Add to</span>
      <div className="seg sm" role="radiogroup" aria-label="Add to" onKeyDown={onKeyDown}>
        {TARGETS.map((t) => {
          const on = t.target === target;
          return (
            <button key={t.target} type="button" className={on ? "on" : ""} role="radio" aria-checked={on} tabIndex={on ? 0 : -1} onClick={() => onChange(t.target)}>
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Adds a widget to the room and does not open it. Only in this host (the default) it is added at
 * once and the form closes; to the room it stays open, shows "Adding…" while the state event is
 * sent and the refusal (`write`) with the draft kept, and closes once the room has the event.
 */
export function AddWidgetForm({ roomId, roomEvents, localEvents, edit, write, userId, initial, onClose }: AddWidgetFormProps) {
  const dispatch = useDispatch();
  const { widgetEvents } = useViewEnv();
  const { urlProblem } = widgetEvents;
  const [draft, setDraft] = useState<AddWidgetDraft>(() => ({
    form: "testWidget",
    target: "local",
    testWidget: newTestWidgetDraft(freeWidgetId([...roomEvents, ...localEvents])),
    widget: edit ? widgetDraftOf(edit) : newWidgetDraft(freeWidgetId([...roomEvents, ...localEvents])),
    call: NEW_ELEMENT_CALL,
    json: "",
    ...initial,
  }));
  const [error, setError] = useState<string>();
  /** The event last sent to the room: the form closes once the room has it. */
  const [sent, setSent] = useState<StateEvent>();
  const sending = write?.state === "sending";

  // TODO-FINDING add-widget-room-write-done - the form closes once the room lists the event it sent (not when `widgetWrite` disappears: that also happens when the replace confirmation is cancelled). With a Matrix account it shows its buttons again between the send and the sync.
  useEffect(() => {
    if (sent && !write && roomEvents.some((e) => sameEvent(e, sent))) onClose();
  }, [sent, write, roomEvents, onClose]);

  const build = (): StateEvent | string => {
    if (edit) return buildWidgetEvent(draft.widget, urlProblem, { base: edit.content });
    switch (draft.form) {
      case "testWidget":
        return buildTestWidgetEvent(draft.testWidget, userId);
      case "widget":
        return buildWidgetEvent(draft.widget, urlProblem, { userId });
      case "elementCall":
        return buildElementCallEvent(draft.call, urlProblem, userId);
      case "json":
        return parseWidgetEvent(draft.json, widgetEvents);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (sending) return;
    const event = build();
    if (typeof event === "string") return setError(event);
    setError(undefined);
    const target = edit ? "local" : draft.target;
    dispatch({ type: "room/addWidget", roomId, event, target });
    if (target === "local") onClose();
    else setSent(event);
  };
  /** A change of the draft takes a refusal of the form away (not one of the room: that stays until the next try). */
  const change = (part: Partial<AddWidgetDraft>) => {
    setError(undefined);
    setDraft((d) => ({ ...d, ...part }));
  };
  const hint = TARGETS.find((t) => t.target === draft.target)?.hint;
  const name = edit && (typeof edit.content.name === "string" && edit.content.name ? edit.content.name : edit.state_key);

  return (
    <form className="form add-widget" aria-label={edit ? `Edit ${name}` : "Add widget"} onSubmit={submit}>
      {!edit && <FormChips forms={FORMS} active={draft.form} label="Widget form" onSelect={(form) => change({ form })} />}
      {!edit && draft.form === "testWidget" && <TestWidgetFields draft={draft.testWidget} onChange={(testWidget) => change({ testWidget })} />}
      {(edit || draft.form === "widget") && <WidgetFields draft={draft.widget} onChange={(widget) => change({ widget })} locked={!!edit} />}
      {!edit && draft.form === "elementCall" && <ElementCallFields draft={draft.call} onChange={(call) => change({ call })} />}
      {!edit && draft.form === "json" && (
        <>
          <JsonArea label="Widget state event (JSON)" value={draft.json} onChange={(json) => change({ json })} />
          <p className="hint">A whole widget state event: its type, state key and content are used, other fields are ignored.</p>
        </>
      )}
      {!edit && (
        <>
          <TargetSeg target={draft.target} onChange={(target) => change({ target })} />
          <p className="hint">{hint}</p>
        </>
      )}
      {error && <FormRefusal title={edit ? "The widget cannot be saved" : "The widget cannot be added"} reason={error} />}
      {write?.state === "failed" && <FormRefusal title="The room refused the widget" reason={write.error} />}
      <div className="inline-row">
        <span className="sp" />
        <Button sm onClick={onClose}>
          Cancel
        </Button>
        <Button kind="primary" sm icon={edit ? "check" : "plus"} type="submit" disabled={sending}>
          {edit ? "Save" : sending ? "Adding…" : "Add widget"}
        </Button>
      </div>
    </form>
  );
}
