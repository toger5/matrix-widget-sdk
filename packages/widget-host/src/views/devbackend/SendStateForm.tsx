/** "Send state" of the State section: predefined forms and raw JSON (mockup functions `sendStateForm`, `formChips`). leaves devbackend/state, devbackend/state-element-call, devbackend/state-raw */
import { useState, type FormEvent } from "react";

import type { DevBackendViewModel, MockedStateEvent, RoomId } from "../../appViewModel";
import { EXAMPLE_LEGACY, EXAMPLE_NEW } from "../../exampleWidgets";
import { WIDGET_EVENT_TYPES, widgetUrlProblem } from "../../widgetStateEvent";
import { useDispatch } from "../env";
import { Field, Toggle } from "../ui/atoms";
import { DelayRow, FormChips, FormError, JsonArea, NO_DELAY, Sub, delayOf, parseJsonObject, pretty } from "./parts";

type StateForm = DevBackendViewModel["stateForm"];

const FORMS: { form: StateForm; label: string }[] = [
  { form: "widget", label: "Widget" },
  { form: "elementCall", label: "Element Call" },
  { form: "raw", label: "Raw JSON" },
];

const LEGACY_TYPE = EXAMPLE_LEGACY.type;
/** The test widget a widget form of this event type starts with. */
const exampleOf = (type: string) => (type === LEGACY_TYPE ? EXAMPLE_LEGACY : EXAMPLE_NEW).content as { name: string; url: string };

/** The first `widget-<n>` that no widget state event of the room uses. */
function freeWidgetId(state: MockedStateEvent[]): string {
  const taken = new Set(state.filter((e) => WIDGET_EVENT_TYPES.includes(e.type)).map((e) => e.stateKey));
  let n = 1;
  while (taken.has(`widget-${n}`)) n++;
  return `widget-${n}`;
}

/** The forms check the URL as the host does before it embeds a widget (the Raw JSON form does not, so a widget that the room overview lists disabled can be tried). */
const isHttpUrl = (url: string) => !widgetUrlProblem(url);

/** The `intent` URL parameter of Element Call (`UserIntent`, `src/UrlConfiguration.ts`): it picks the defaults of everything else (lobby, header, ringing). */
const ELEMENT_CALL_INTENTS = ["start_call", "join_existing", "start_call_voice", "join_existing_voice", "start_call_dm", "join_existing_dm", "start_call_dm_voice", "join_existing_dm_voice"];

/**
 * The Element Call widget as Element Web describes its call. Element Web v1.12.35
 * (`apps/web/src/models/Call.ts`: `createOrGetCallWidget`, `generateWidgetUrl`) never writes it to
 * the room: it adds a virtual widget of type `m.call` with `waitForIframeLoad: false` and the URL
 * parameters in the fragment (a fragment of `url` is replaced). A state event is shared, so user,
 * device, room and language are template variables here (the theme is one in Element Web too);
 * the compat wrapper fills them in and adds `widgetId` and `parentUrl` to the query, as Element
 * Web does. Element Call v0.28.2 reads a parameter from the fragment, else from the query, and
 * needs `roomId`, `userId`, `deviceId`, `baseUrl`, `widgetId` and `parentUrl` in widget mode
 * (`src/UrlParams.ts`, `docs/url_params.md`). Element Web's extras (`fontScale`, `background`,
 * analytics and rageshake parameters) are left out.
 */
function elementCallEvent({ url, intent, stateKey, userId }: { url: string; intent: string; stateKey: string; userId?: string }): MockedStateEvent {
  const params = [
    `intent=${intent}`,
    "roomId=$matrix_room_id",
    "userId=$matrix_user_id",
    "deviceId=$org.matrix.msc3819.matrix_device_id",
    "baseUrl=$org.matrix.msc4039.matrix_base_url",
    "lang=$org.matrix.msc2873.client_language",
    "theme=$org.matrix.msc2873.client_theme",
  ];
  return {
    type: LEGACY_TYPE,
    stateKey,
    content: { type: "m.call", name: "Element Call", url: `${url.split("#")[0]}#?${params.join("&")}`, waitForIframeLoad: false, ...(userId ? { creatorUserId: userId } : {}) },
  };
}

interface Props {
  roomId: RoomId;
  form: StateForm;
  /** The room's current state: the free widget ID and the raw form's prefill come from it. */
  state: MockedStateEvent[];
  /** The DevBackend user: `creatorUserId` of legacy widgets. */
  userId?: string;
}

export function SendStateForm({ roomId, form, state, userId }: Props) {
  const dispatch = useDispatch();
  const [widget, setWidget] = useState(() => ({ type: EXAMPLE_NEW.type, stateKey: freeWidgetId(state), ...exampleOf(EXAMPLE_NEW.type), usesWidgetApi: true }));
  const [call, setCall] = useState({ url: "https://call.element.io/room", intent: ELEMENT_CALL_INTENTS[0], stateKey: "element-call" });
  const [raw, setRaw] = useState(() => ({ type: "m.room.topic", stateKey: "", content: pretty(state.find((e) => e.type === "m.room.topic" && e.stateKey === "")?.content ?? { topic: "" }) }));
  const [delay, setDelay] = useState(NO_DELAY);
  const [error, setError] = useState<string>();
  const legacy = widget.type === LEGACY_TYPE;

  /** Switching between a new and a legacy event type swaps the prefilled test widget, unless it was edited. */
  const changeType = (type: string) => {
    const from = exampleOf(widget.type);
    const to = exampleOf(type);
    setWidget({ ...widget, type, name: widget.name === from.name ? to.name : widget.name, url: widget.url === from.url ? to.url : widget.url });
  };

  /** The state event of the shown form, or what is wrong with the draft. */
  const build = (): MockedStateEvent | string => {
    switch (form) {
      case "widget": {
        const stateKey = widget.stateKey.trim();
        if (!stateKey) return "The widget ID is missing.";
        if (!widget.name.trim()) return "The name is missing.";
        if (!isHttpUrl(widget.url.trim())) return "The URL must start with http:// or https://.";
        const common = { name: widget.name.trim(), url: widget.url.trim() };
        const content = legacy ? { ...EXAMPLE_LEGACY.content, ...common, ...(userId ? { creatorUserId: userId } : {}) } : { ...common, uses_widget_api: widget.usesWidgetApi };
        return { type: widget.type, stateKey, content };
      }
      case "elementCall": {
        const stateKey = call.stateKey.trim();
        if (!stateKey) return "The widget ID is missing.";
        if (!isHttpUrl(call.url.trim())) return "The Element Call URL must start with http:// or https://.";
        return elementCallEvent({ url: call.url.trim(), intent: call.intent, stateKey, userId });
      }
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
    dispatch({ type: "mock/sendState", roomId, event, ...(delayed.delayMs === undefined ? {} : { delayMs: delayed.delayMs }) });
  };
  const selectForm = (next: StateForm) => {
    setError(undefined);
    dispatch({ type: "mock/setStateForm", form: next });
  };

  return (
    <>
      <Sub title="Send state" />
      <FormChips forms={FORMS} active={form} label="State form" onSelect={selectForm} />
      <form className="form" aria-label="Send state" onSubmit={submit}>
        {form === "widget" && (
          <>
            <Field label="Event type">
              <select className="input mono" value={widget.type} onChange={(e) => changeType(e.target.value)}>
                {WIDGET_EVENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Widget ID">
              <input className="input mono" value={widget.stateKey} onChange={(e) => setWidget({ ...widget, stateKey: e.target.value })} />
            </Field>
            <Field label="Name">
              <input className="input" value={widget.name} onChange={(e) => setWidget({ ...widget, name: e.target.value })} />
            </Field>
            <Field label="URL">
              <input className="input mono" value={widget.url} onChange={(e) => setWidget({ ...widget, url: e.target.value })} />
            </Field>
            {!legacy && (
              <div className="inline-row">
                <Toggle on={widget.usesWidgetApi} label="Uses the widget API" onChange={(usesWidgetApi) => setWidget({ ...widget, usesWidgetApi })} />
                <span>Uses the widget API</span>
              </div>
            )}
          </>
        )}
        {form === "elementCall" && (
          <>
            <Field label="Element Call URL">
              <input className="input mono" value={call.url} onChange={(e) => setCall({ ...call, url: e.target.value })} />
            </Field>
            <Field label="Intent">
              <select className="input mono" value={call.intent} onChange={(e) => setCall({ ...call, intent: e.target.value })}>
                {ELEMENT_CALL_INTENTS.map((intent) => (
                  <option key={intent} value={intent}>
                    {intent}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Widget ID">
              <input className="input mono" value={call.stateKey} onChange={(e) => setCall({ ...call, stateKey: e.target.value })} />
            </Field>
            <p className="hint">
              A legacy <span className="mono">m.call</span> widget, as Element Web describes its call. The compat wrapper fills in the user, device, room, language and theme.
            </p>
          </>
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
        <DelayRow delay={delay} onChange={setDelay} />
      </form>
    </>
  );
}
