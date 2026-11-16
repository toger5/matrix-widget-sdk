/** "Send state" of the State section: predefined forms (`../forms/widgetForms`) and raw JSON. stories `sidepanel-devbackendview--state`, `sidepanel-devbackendview-state--*`, `sidepanel-roomtoolsview--state` */
import { useState, type FormEvent } from "react";

import type { MockedStateEvent, RoomId, RoomToolsViewModel } from "../../appViewModel";
import type { StateEvent } from "../../widgetStateEvent";
import { useDispatch, useViewEnv } from "../env";
import { ElementCallFields, NEW_ELEMENT_CALL, WidgetFields, buildElementCallEvent, buildWidgetEvent, freeWidgetId, newWidgetDraft } from "../forms/widgetForms";
import { Field } from "../ui/atoms";
import { FormChips, FormError, JsonArea, parseJsonObject, pretty } from "../ui/forms";
import { DelayRow, NO_DELAY, Sub, delayOf } from "./parts";

type StateForm = RoomToolsViewModel["stateForm"];

const FORMS: { form: StateForm; label: string }[] = [
  { form: "widget", label: "Widget" },
  { form: "elementCall", label: "Element Call" },
  { form: "raw", label: "Raw JSON" },
];

/** The room's state as the state events the widget forms look at. */
const asStateEvents = (state: MockedStateEvent[]): StateEvent[] => state.map((e) => ({ type: e.type, state_key: e.stateKey, content: e.content }));
/** A built state event as `roomTools/sendState` takes it; a string (what is wrong with the draft) stays. */
const asMocked = (event: StateEvent | string): MockedStateEvent | string => (typeof event === "string" ? event : { type: event.type, stateKey: event.state_key, content: event.content });

interface Props {
  roomId: RoomId;
  form: StateForm;
  /** The room's current state: the free widget ID and the raw form's prefill come from it. */
  state: MockedStateEvent[];
  /** The DevBackend user or the account: `creatorUserId` of legacy widgets. */
  userId?: string;
}

export function SendStateForm({ roomId, form, state, userId }: Props) {
  const dispatch = useDispatch();
  const { urlProblem } = useViewEnv().widgetEvents;
  const [widget, setWidget] = useState(() => newWidgetDraft(freeWidgetId(asStateEvents(state))));
  const [call, setCall] = useState(NEW_ELEMENT_CALL);
  const [raw, setRaw] = useState(() => ({ type: "m.room.topic", stateKey: "", content: pretty(state.find((e) => e.type === "m.room.topic" && e.stateKey === "")?.content ?? { topic: "" }) }));
  const [delay, setDelay] = useState(NO_DELAY);
  const [error, setError] = useState<string>();

  /** The state event of the shown form, or what is wrong with the draft. The Raw JSON form does not check the URL, so a widget that the room overview lists disabled can be tried. */
  const build = (): MockedStateEvent | string => {
    switch (form) {
      case "widget":
        return asMocked(buildWidgetEvent(widget, urlProblem, { userId }));
      case "elementCall":
        return asMocked(buildElementCallEvent(call, urlProblem, userId));
      case "raw": {
        if (!raw.type.trim()) return "The event type is missing.";
        const content = parseJsonObject(raw.content);
        return "error" in content ? content.error : { type: raw.type.trim(), stateKey: raw.stateKey, content: content.value };
      }
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const event = build();
    const delayed = delayOf(delay);
    const problem = typeof event === "string" ? event : delayed.error;
    setError(problem);
    if (problem || typeof event === "string") return;
    dispatch({ type: "roomTools/sendState", roomId, event, ...(delayed.delayMs === undefined ? {} : { delayMs: delayed.delayMs }) });
  };
  const selectForm = (next: StateForm) => {
    setError(undefined);
    dispatch({ type: "roomTools/setStateForm", form: next });
  };

  return (
    <>
      <Sub title="Send state" />
      <FormChips forms={FORMS} active={form} label="State form" onSelect={selectForm} />
      <form className="form" aria-label="Send state" onSubmit={submit}>
        {form === "widget" && <WidgetFields draft={widget} onChange={setWidget} />}
        {form === "elementCall" && <ElementCallFields draft={call} onChange={setCall} />}
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
        <DelayRow delay={delay} onChange={setDelay} />
      </form>
    </>
  );
}
