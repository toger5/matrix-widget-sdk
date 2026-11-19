/**
 * "Send state" of the State panel: a collapsible heading with the menu of its forms (the widget forms
 * of `../forms/widgetForms`, the shortcuts, raw JSON). A widget form whose event names a widget the
 * room has sends with "Update widget". stories `sidepanel-devbackendview--state`,
 * `sidepanel-devbackendview-state--*`, `sidepanel-roomtoolsview--state`, `sidepanel-roomtoolsview--state-form-menu`
 */
import { useState, type FormEvent } from "react";

import type { MockedStateEvent, RoomId, RoomToolsViewModel } from "../../appViewModel";
import type { StateEvent } from "../../widgetStateEvent";
import { useDispatch, useViewEnv } from "../env";
import {
  ElementCallFields,
  LEGACY_TYPE,
  NEW_ELEMENT_CALL,
  TestWidgetFields,
  WidgetFields,
  buildElementCallEvent,
  buildTestWidgetEvent,
  buildWidgetEvent,
  freeWidgetId,
  newTestWidgetDraft,
  newWidgetDraft,
} from "../forms/widgetForms";
import { Button, Field } from "../ui/atoms";
import { FormError, JsonArea, parseJsonObject, pretty } from "../ui/forms";
import { Compose, DelayRow, NO_DELAY, delayOf, type FormMenuItem } from "./parts";
import type { RoomBoxMode } from "./RoomBox";

type StateForm = RoomToolsViewModel["stateForm"];

const FORMS: FormMenuItem<StateForm>[] = [
  { form: "testWidget", label: "Test widget" },
  { form: "widget", label: "Widget" },
  { form: "elementCall", label: "Element Call" },
  { form: "name", label: "Edit name", group: true },
  { form: "topic", label: "Edit description" },
  { form: "member", label: "Add member" },
  { form: "raw", label: "Raw JSON", group: true },
];

type Shortcut = "name" | "topic" | "member";
const SHORTCUTS: Record<Shortcut, { label: string; save: string }> = {
  name: { label: "Room name", save: "Save" },
  topic: { label: "Description", save: "Save" },
  member: { label: "User ID", save: "Add" },
};
const isShortcut = (form: StateForm): form is Shortcut => Object.hasOwn(SHORTCUTS, form);

/** The room's state as the state events the widget forms look at. */
const asStateEvents = (state: MockedStateEvent[]): StateEvent[] => state.map((e) => ({ type: e.type, state_key: e.stateKey, content: e.content }));
/** A built state event as `roomTools/sendState` takes it; a string (what is wrong with the draft) stays. */
const asMocked = (event: StateEvent | string): MockedStateEvent | string => (typeof event === "string" ? event : { type: event.type, stateKey: event.state_key, content: event.content });
/** Whether the room has a widget under this event type and state key: a state event that is not empty (`{}` removed the widget). */
const hasWidget = (state: MockedStateEvent[], type: string, stateKey: string) => state.some((e) => e.type === type && e.stateKey === stateKey && Object.keys(e.content).length > 0);

interface Props {
  /** "account": a real room, where "Add member" would need an invite: not offered. */
  mode: RoomBoxMode;
  roomId: RoomId;
  form: StateForm;
  /** The room's current state: the free widget ID and the raw form's prefill come from it. */
  state: MockedStateEvent[];
  /** The DevBackend user or the account: `creatorUserId` of legacy widgets. */
  userId?: string;
}

export function SendStateForm({ mode, roomId, form: chosen, state, userId }: Props) {
  const dispatch = useDispatch();
  const forms = FORMS.filter((f) => f.form !== "member" || mode === "devBackend");
  // "Add member" chosen in the DevBackend, then the Dev tools of an account: the default form.
  const form: StateForm = forms.some((f) => f.form === chosen) ? chosen : "testWidget";
  const [open, setOpen] = useState(false);
  const contentOf = (type: string) => state.find((e) => e.type === type && e.stateKey === "")?.content;
  // A shortcut starts on what the room has; its text is kept while the form is shown.
  const [shortcut, setShortcut] = useState<{ form: Shortcut; value: string }>();
  const shortcutValue = (kind: Shortcut) => {
    if (shortcut?.form === kind) return shortcut.value;
    const current = kind === "name" ? contentOf("m.room.name")?.name : kind === "topic" ? contentOf("m.room.topic")?.topic : "";
    return typeof current === "string" ? current : "";
  };
  const { widgetEvents } = useViewEnv();
  const [testWidget, setTestWidget] = useState(() => newTestWidgetDraft(freeWidgetId(asStateEvents(state))));
  const [widget, setWidget] = useState(() => newWidgetDraft(freeWidgetId(asStateEvents(state))));
  const [call, setCall] = useState(NEW_ELEMENT_CALL);
  const [raw, setRaw] = useState(() => ({ type: "m.room.topic", stateKey: "", content: pretty(state.find((e) => e.type === "m.room.topic" && e.stateKey === "")?.content ?? { topic: "" }) }));
  const [delay, setDelay] = useState(NO_DELAY);
  const [error, setError] = useState<string>();

  /** The state event of the shown form, or what is wrong with the draft. The Raw JSON form does not check the URL, so a widget that the room overview lists disabled can be tried. */
  const build = (): MockedStateEvent | string => {
    if (isShortcut(form)) {
      const value = shortcutValue(form).trim();
      if (form === "name") return { type: "m.room.name", stateKey: "", content: { name: value } };
      if (form === "topic") return { type: "m.room.topic", stateKey: "", content: { topic: value } };
      if (!/^@[^:\s]+:\S+$/.test(value)) return "A user ID looks like @user:server.";
      // TODO-FINDING devbackend-add-member-content - "add member" sends only { membership: "join" }; a display name or avatar needs "send state" or the edit button.
      return { type: "m.room.member", stateKey: value, content: { membership: "join" } };
    }
    switch (form) {
      case "testWidget":
        return asMocked(buildTestWidgetEvent(testWidget, userId));
      case "widget":
        return asMocked(buildWidgetEvent(widget, widgetEvents, { userId }));
      case "elementCall":
        return asMocked(buildElementCallEvent(call, widgetEvents, userId));
      case "raw": {
        if (!raw.type.trim()) return "The event type is missing.";
        const content = parseJsonObject(raw.content);
        return "error" in content ? content.error : { type: raw.type.trim(), stateKey: raw.stateKey, content: content.value };
      }
    }
  };
  /** The widget the shown widget form writes (event type and widget ID), if it is one. */
  const target = form === "testWidget" ? testWidget : form === "widget" ? widget : form === "elementCall" ? { type: LEGACY_TYPE, stateKey: call.stateKey } : undefined;
  const update = !!target && hasWidget(state, target.type, target.stateKey.trim());
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const event = build();
    const delayed = isShortcut(form) ? {} : delayOf(delay);
    const problem = typeof event === "string" ? event : delayed.error;
    setError(problem);
    if (problem || typeof event === "string") return;
    dispatch({ type: "roomTools/sendState", roomId, event, ...(delayed.delayMs === undefined ? {} : { delayMs: delayed.delayMs }) });
  };
  const selectForm = (next: StateForm) => {
    setError(undefined);
    // A shortcut chosen again starts on what the room has now.
    setShortcut(undefined);
    dispatch({ type: "roomTools/setStateForm", form: next });
  };

  return (
    <Compose name="Send state" open={open} onOpen={setOpen} forms={forms} active={form} onSelect={selectForm}>
      <form className="form" aria-label="Send state" onSubmit={submit}>
        {form === "testWidget" && <TestWidgetFields draft={testWidget} onChange={setTestWidget} />}
        {form === "widget" && <WidgetFields draft={widget} onChange={setWidget} />}
        {form === "elementCall" && <ElementCallFields draft={call} onChange={setCall} />}
        {isShortcut(form) && (
          <Field label={SHORTCUTS[form].label}>
            <input
              className={`input ${form === "member" ? "mono" : ""}`}
              placeholder={form === "member" ? "@user:dev.local" : undefined}
              value={shortcutValue(form)}
              onChange={(e) => setShortcut({ form, value: e.target.value })}
            />
          </Field>
        )}
        {form === "raw" && (
          <>
            <Field label="Type">
              <input className="input mono" value={raw.type} onChange={(e) => setRaw({ ...raw, type: e.target.value })} />
            </Field>
            <Field label="State key">
              <input className="input mono" placeholder="empty" value={raw.stateKey} onChange={(e) => setRaw({ ...raw, stateKey: e.target.value })} />
            </Field>
            <JsonArea label="State content (JSON)" value={raw.content} onChange={(content) => setRaw({ ...raw, content })} />
          </>
        )}
        <FormError error={error} />
        {isShortcut(form) ? (
          <div className="inline-row">
            <span className="sp" />
            <Button kind="primary" sm type="submit">
              {SHORTCUTS[form].save}
            </Button>
          </div>
        ) : (
          <DelayRow delay={delay} onChange={setDelay} update={update} />
        )}
      </form>
    </Compose>
  );
}
