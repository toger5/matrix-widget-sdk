/**
 * The widget forms that describe a widget state event: "Send state" of the DevBackendView and
 * "Add widget" of the RoomOverview. The
 * fields are controlled: the draft is the view state of the form that renders them.
 */
import { useId } from "react";

import { EXAMPLE_LEGACY, TEST_WIDGETS } from "../../exampleWidgets";
import { WIDGET_EVENT_TYPES, type StateEvent, type WidgetEventParser } from "../../widgetStateEvent";
import { useDispatch } from "../env";
import { Field, IconButton, Toggle } from "../ui/atoms";
import { parseJsonObject } from "../ui/forms";

export const LEGACY_TYPE = EXAMPLE_LEGACY.type;

/** The first `widget-<n>` that no widget state event of `events` uses. */
export function freeWidgetId(events: Iterable<Pick<StateEvent, "type" | "state_key">>): string {
  const taken = new Set([...events].filter((e) => WIDGET_EVENT_TYPES.includes(e.type)).map((e) => e.state_key));
  let n = 1;
  while (taken.has(`widget-${n}`)) n++;
  return `widget-${n}`;
}

/** The event a form built, or why the host would not embed it (`ViewEnv.widgetEvents`, the driver's parser). */
const checked = (event: StateEvent, widgetEvents: WidgetEventParser, what = "URL"): StateEvent | string => {
  const problem = widgetEvents.resolve(event)?.problem;
  return problem ? `The ${what} cannot be embedded: ${problem}.` : event;
};

// ---------------------------------------------------------------------------------------------
// The widget form

export interface WidgetDraft {
  type: string;
  stateKey: string;
  name: string;
  url: string;
  usesWidgetApi: boolean;
}

/** A new custom widget: `m.widget`, no name and no URL yet. */
export const newWidgetDraft = (stateKey: string): WidgetDraft => ({ type: WIDGET_EVENT_TYPES[0], stateKey, name: "", url: "", usesWidgetApi: true });

/** The draft of an existing widget state event (editing a local widget). */
export const widgetDraftOf = (event: StateEvent): WidgetDraft => ({
  type: event.type,
  stateKey: event.state_key,
  name: typeof event.content.name === "string" ? event.content.name : "",
  url: typeof event.content.url === "string" ? event.content.url : "",
  usesWidgetApi: event.content.uses_widget_api === true,
});

/**
 * The state event of a widget draft, or what is wrong with it. `base`: the content the draft
 * changes (editing keeps the fields the form does not show); without it a legacy widget gets
 * `type: "m.custom"`, `waitForIframeLoad` and `userId` as its `creatorUserId`.
 */
export function buildWidgetEvent(draft: WidgetDraft, widgetEvents: WidgetEventParser, { userId, base }: { userId?: string; base?: Record<string, unknown> } = {}): StateEvent | string {
  const stateKey = draft.stateKey.trim();
  if (!stateKey) return "The widget ID is missing.";
  if (!draft.name.trim()) return "The name is missing.";
  const common = { name: draft.name.trim(), url: draft.url.trim() };
  const legacy = draft.type === LEGACY_TYPE;
  const from = base ?? (legacy ? { type: "m.custom", waitForIframeLoad: true, ...(userId ? { creatorUserId: userId } : {}) } : {});
  const content = legacy ? { ...from, ...common } : { ...from, ...common, uses_widget_api: draft.usesWidgetApi };
  return checked({ type: draft.type, state_key: stateKey, content }, widgetEvents);
}

/** The fields of the widget form: any custom widget. `locked`: editing a widget, its event type and ID are fixed. */
export function WidgetFields({ draft, onChange, locked = false }: { draft: WidgetDraft; onChange: (draft: WidgetDraft) => void; locked?: boolean }) {
  const legacy = draft.type === LEGACY_TYPE;
  return (
    <>
      <Field label="Event type">
        {locked ? (
          <input className="input mono" value={draft.type} readOnly />
        ) : (
          <select className="input mono" value={draft.type} onChange={(e) => onChange({ ...draft, type: e.target.value })}>
            {WIDGET_EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Widget ID">
        <input className="input mono" value={draft.stateKey} readOnly={locked} onChange={(e) => onChange({ ...draft, stateKey: e.target.value })} />
      </Field>
      <Field label="Name">
        <input className="input" placeholder="My widget" value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
      </Field>
      <Field label="URL">
        <input className="input mono" placeholder="https://…" value={draft.url} onChange={(e) => onChange({ ...draft, url: e.target.value })} />
      </Field>
      {!legacy && (
        <div className="inline-row">
          <Toggle on={draft.usesWidgetApi} label="Uses the widget API" onChange={(usesWidgetApi) => onChange({ ...draft, usesWidgetApi })} />
          <span>Uses the widget API</span>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The test widget form

/** A test widget: which of `TEST_WIDGETS` (by its event type) under which widget ID. Name and URL are the test widget's. */
export interface TestWidgetDraft {
  type: string;
  stateKey: string;
}

/** A new test widget: the new test widget as `m.widget`. */
export const newTestWidgetDraft = (stateKey: string): TestWidgetDraft => ({ type: TEST_WIDGETS[0].type, stateKey });

/** The test widget of this event type. */
export const testWidgetOf = (type: string): StateEvent => TEST_WIDGETS.find((w) => w.type === type) ?? TEST_WIDGETS[0];

const testWidgetLabel = (type: string) => `${type} · ${type === LEGACY_TYPE ? "legacy" : "new"} test widget`;

/**
 * The state event of a test widget draft, or what is wrong with it. The URL is not checked: the
 * host ships the test widgets and embeds them. A legacy test widget gets `userId` as its
 * `creatorUserId`.
 */
export function buildTestWidgetEvent(draft: TestWidgetDraft, userId?: string): StateEvent | string {
  const stateKey = draft.stateKey.trim();
  if (!stateKey) return "The widget ID is missing.";
  const { type, content } = testWidgetOf(draft.type);
  return { type, state_key: stateKey, content: { ...content, ...(type === LEGACY_TYPE && userId ? { creatorUserId: userId } : {}) } };
}

/**
 * The fields of the test widget form: only the test widget (one per event type) and the widget
 * ID can be chosen. The URL is shown read-only with a copy button, so a test widget cannot be lost
 * by editing it.
 */
export function TestWidgetFields({ draft, onChange }: { draft: TestWidgetDraft; onChange: (draft: TestWidgetDraft) => void }) {
  const dispatch = useDispatch();
  const urlLabel = useId();
  const url = String(testWidgetOf(draft.type).content.url);
  return (
    <>
      <Field label="Test widget">
        <select className="input mono" value={draft.type} onChange={(e) => onChange({ ...draft, type: e.target.value })}>
          {TEST_WIDGETS.map(({ type }) => (
            <option key={type} value={type}>
              {testWidgetLabel(type)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Widget ID">
        <input className="input mono" value={draft.stateKey} onChange={(e) => onChange({ ...draft, stateKey: e.target.value })} />
      </Field>
      <div className="field">
        <span className="field-l" id={urlLabel}>
          URL
        </span>
        <div className="inline-row">
          <input className="input mono grow" value={url} readOnly aria-readonly="true" aria-labelledby={urlLabel} />
          <IconButton icon="copy" title="Copy the URL" onClick={() => dispatch({ type: "widget/copyUrl", url })} />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The Element Call form

/** The `intent` URL parameter of Element Call (`UserIntent`, `src/UrlConfiguration.ts`): it picks the defaults of everything else (lobby, header, ringing). */
const ELEMENT_CALL_INTENTS = ["start_call", "join_existing", "start_call_voice", "join_existing_voice", "start_call_dm", "join_existing_dm", "start_call_dm_voice", "join_existing_dm_voice"];

export interface ElementCallDraft {
  url: string;
  intent: string;
  stateKey: string;
}

export const NEW_ELEMENT_CALL: ElementCallDraft = { url: "https://call.element.io/room", intent: ELEMENT_CALL_INTENTS[0], stateKey: "element-call" };

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
export function elementCallEvent({ url, intent, stateKey, userId }: { url: string; intent: string; stateKey: string; userId?: string }): StateEvent {
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
    state_key: stateKey,
    content: { type: "m.call", name: "Element Call", url: `${url.split("#")[0]}#?${params.join("&")}`, waitForIframeLoad: false, ...(userId ? { creatorUserId: userId } : {}) },
  };
}

/** The state event of an Element Call draft, or what is wrong with it. */
export function buildElementCallEvent(draft: ElementCallDraft, widgetEvents: WidgetEventParser, userId?: string): StateEvent | string {
  const stateKey = draft.stateKey.trim();
  if (!stateKey) return "The widget ID is missing.";
  return checked(elementCallEvent({ url: draft.url.trim(), intent: draft.intent, stateKey, userId }), widgetEvents, "Element Call URL");
}

export function ElementCallFields({ draft, onChange }: { draft: ElementCallDraft; onChange: (draft: ElementCallDraft) => void }) {
  return (
    <>
      <Field label="Element Call URL">
        <input className="input mono" value={draft.url} onChange={(e) => onChange({ ...draft, url: e.target.value })} />
      </Field>
      <Field label="Intent">
        <select className="input mono" value={draft.intent} onChange={(e) => onChange({ ...draft, intent: e.target.value })}>
          {ELEMENT_CALL_INTENTS.map((intent) => (
            <option key={intent} value={intent}>
              {intent}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Widget ID">
        <input className="input mono" value={draft.stateKey} onChange={(e) => onChange({ ...draft, stateKey: e.target.value })} />
      </Field>
      <p className="hint">
        A legacy <span className="mono">m.call</span> widget, as Element Web describes its call. The compat wrapper fills in the user, device, room, language and theme.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// A pasted state event

/**
 * A whole widget state event, pasted (e.g. from Element's room state explorer): its `type`,
 * `state_key` and `content` are used, other fields are ignored. Refused: a type that is not a
 * widget type, content that describes no widget (an `m.widget` without a name), and a URL the
 * host would not embed. `widgetEvents`: `ViewEnv.widgetEvents`.
 */
export function parseWidgetEvent(text: string, widgetEvents: WidgetEventParser): StateEvent | string {
  const parsed = parseJsonObject(text);
  if ("error" in parsed) return parsed.error;
  const { type, state_key: stateKey, content } = parsed.value;
  if (typeof type !== "string" || !WIDGET_EVENT_TYPES.includes(type)) return `The type must be a widget type: ${WIDGET_EVENT_TYPES.join(", ")}.`;
  if (typeof stateKey !== "string" || !stateKey) return "The state_key (the widget ID) is missing.";
  if (typeof content !== "object" || content === null || Array.isArray(content)) return "The content must be an object.";
  const { url } = content as Record<string, unknown>;
  if (typeof url !== "string") return "The content has no url.";
  const event = { type, state_key: stateKey, content: content as Record<string, unknown> };
  if (!widgetEvents.resolve(event)) return "The content describes no widget: an m.widget needs a name.";
  return checked(event, widgetEvents);
}
