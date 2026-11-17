/** The `ViewEnv` of the stories: intents are logged, the data hooks answer from fixtures, widgets are fakes. */
import type { Decorator, Parameters } from "@storybook/react-vite";
import type { CSSProperties, ReactNode } from "react";
import { waitFor } from "storybook/test";

import { WIDGET_EVENT_TYPES, type WidgetEventParser } from "../widgetStateEvent";
import { DEFAULT_VIEW_ENV, ViewEnvContext, type RoomStateData, type RoomTimelineData, type ViewEnv } from "./env";
import { Icon } from "./ui/atoms";
import { DEV_TOOLS_DATA, MOCKED_ROOM_DATA, MOCKED_ROOM_STATE, MOCKED_ROOM_TIMELINE, ROOM_DETAILS, ROOM_STATE, ROOM_TIMELINE, ROOMS } from "./fixtures";

const retry = (what: string) => () => console.info(`retry the ${what}`);
const TIMELINE: RoomTimelineData = { timeline: { status: "ready", value: ROOM_TIMELINE }, retry: retry("timeline") };
const STATE: RoomStateData = { state: { status: "ready", value: ROOM_STATE }, retry: retry("state") };
/** "Widget lab", the mocked room of the DevBackendView stories. */
const LAB_TIMELINE: RoomTimelineData = { timeline: { status: "ready", value: MOCKED_ROOM_TIMELINE }, retry: retry("timeline") };
const LAB_STATE: RoomStateData = { state: { status: "ready", value: MOCKED_ROOM_STATE }, retry: retry("state") };

/**
 * A stand-in for the driver's parser (stories load no wasm): every widget type with a string `url`
 * (and, MSC4411, a string `name` for `m.widget`) is a widget, and one with an absolute http(s) URL may
 * be loaded (one of Storybook's origin asks first). The URL check is coarser than the driver's.
 */
const STORY_WIDGET_EVENTS: WidgetEventParser = {
  resolve(event) {
    const { url, name } = event.content;
    const legacy = event.type === "im.vector.modular.widgets";
    if (typeof url !== "string" || !WIDGET_EVENT_TYPES.includes(event.type) || (!legacy && typeof name !== "string")) return undefined;
    const shown = typeof name === "string" && name ? name : event.state_key;
    const widget = {
      eventType: event.type,
      widgetId: event.state_key,
      name: shown,
      url,
      avatarUrl: undefined,
      usesWidgetApi: !legacy && event.content.uses_widget_api === true,
      legacy: legacy ? { widgetType: undefined, waitForIframeLoad: event.content.waitForIframeLoad !== false, data: undefined } : undefined,
    };
    if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) return { widget, problem: "the URL is not an absolute http: or https: URL" };
    return new URL(url).origin === globalThis.location?.origin ? { widget, sameOrigin: true } : { widget };
  },
};

/** `DEV_TOOLS_DATA` with the run duration of the design ("3 m 12 s") when the stories load, instead of the fixture's fixed date. */
const STORY_DEV_TOOLS_DATA = { ...DEV_TOOLS_DATA, stats: { ...DEV_TOOLS_DATA.stats, runningSince: Date.now() - 192_000 } };

export const STORY_ENV: ViewEnv = {
  ...DEFAULT_VIEW_ENV,
  useDevToolsData: () => STORY_DEV_TOOLS_DATA,
  useMockedRoomData: () => MOCKED_ROOM_DATA,
  useRoomDetails: () => ({ status: "ready", value: ROOM_DETAILS }),
  useRoomTimeline: (roomId) => (roomId === ROOMS.lab.id ? LAB_TIMELINE : TIMELINE),
  useRoomState: (roomId) => (roomId === ROOMS.lab.id ? LAB_STATE : STATE),
  widgetEvents: STORY_WIDGET_EVENTS,
  widgetStandIn: (widget, compact) => <FakeWidget kind={fakeWidgetKind(widget.widgetKey)} name={widget.widget.name} compact={compact} />,
};

/** Wrap a story to override parts of the environment, e.g. `<StoryEnv env={{ narrow: true }}>`. */
export function StoryEnv({ env, children }: { env?: Partial<ViewEnv>; children: ReactNode }) {
  return <ViewEnvContext.Provider value={{ ...STORY_ENV, ...env }}>{children}</ViewEnvContext.Provider>;
}

/** The fake widgets of the stories: what a fixture widget (`WIDGET_EVENTS`) looks like. */
export type FakeWidgetKind = "call" | "board" | "poll" | "notes" | "timer";
const FAKE_KINDS: readonly string[] = ["call", "board", "poll", "notes", "timer"] satisfies FakeWidgetKind[];

/** The fake of a fixture widget, by its key (`m.widget/call` → "call"); undefined for any other widget. */
export const fakeWidgetKind = (widgetKey: string): FakeWidgetKind | undefined => {
  const key = widgetKey.slice(widgetKey.lastIndexOf("/") + 1);
  return FAKE_KINDS.includes(key) ? (key as FakeWidgetKind) : undefined;
};

const hue = (h: number) => ({ "--h": h }) as CSSProperties;

/**
 * A stand-in for a widget iframe: what a `WidgetSlot` shows in a story (`ViewEnv.widgetStandIn`).
 * The fake widgets (a call grid, a whiteboard, a poll, notes, a timer); they do not use the host's
 * tokens, a widget is foreign content (`.storybook/mockup.css`). Another widget is
 * its name on a plain background. `compact`: inside a PiP box.
 */
export function FakeWidget({ kind, name = "Widget", compact = false }: { kind?: FakeWidgetKind; name?: string; compact?: boolean }) {
  const c = compact ? "compact" : "";
  switch (kind) {
    case "call":
      return (
        <div className={`w w-call ${c}`} data-testid="fake-widget">
          <div className="w-grid">
            {(
              [
                ["Mira", 215],
                ["Jonas", 28],
                ["Ada", 265],
                ["Sam", 330],
              ] as const
            ).map(([person, h]) => (
              <div key={person} className="w-tile" style={hue(h)}>
                <span className="w-face">{person[0]}</span>
                <span className="w-name">{person}</span>
              </div>
            ))}
          </div>
          <div className="w-bar">
            {(["mic", "video", "monitor", "phone"] as const).map((icon) => (
              <span key={icon} className={`w-rb ${icon === "phone" ? "red" : ""}`}>
                <Icon name={icon} size={16} />
              </span>
            ))}
          </div>
        </div>
      );
    case "board":
      return (
        <div className={`w w-board ${c}`} data-testid="fake-widget">
          <svg viewBox="0 0 800 500" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <defs>
              <pattern id="fake-board-dots" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1" fill="#d6d2c8" />
              </pattern>
            </defs>
            <rect width="800" height="500" fill="#fbfaf6" />
            <rect width="800" height="500" fill="url(#fake-board-dots)" />
            <rect x="120" y="90" width="150" height="110" rx="6" fill="#ffe07a" />
            <path d="M138 120h100M138 142h80M138 164h110" stroke="#7a6410" strokeWidth="5" strokeLinecap="round" />
            <rect x="330" y="60" width="150" height="110" rx="6" fill="#ffb3c7" />
            <path d="M348 90h105M348 112h70" stroke="#8a2745" strokeWidth="5" strokeLinecap="round" />
            <rect x="540" y="150" width="150" height="110" rx="6" fill="#a9d8ff" />
            <path d="M558 180h95M558 202h110M558 224h60" stroke="#1d4e7a" strokeWidth="5" strokeLinecap="round" />
            <path d="M270 150c30-10 40-30 60-40M480 120c30 10 40 40 60 60" fill="none" stroke="#333" strokeWidth="3" strokeLinecap="round" />
            <ellipse cx="300" cy="360" rx="130" ry="70" fill="none" stroke="#e5484d" strokeWidth="4" />
            <path d="M230 350h140M250 378h100" stroke="#333" strokeWidth="5" strokeLinecap="round" />
            <path d="M500 330l60 70 90-120" fill="none" stroke="#2f9e44" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="w-tools">
            {[0, 1, 2, 3, 4].map((i) => (
              <i key={i} className={i === 2 ? "on" : ""} />
            ))}
          </div>
        </div>
      );
    case "poll":
      return (
        <div className={`w w-poll ${c}`} data-testid="fake-widget">
          <div className="w-poll-in">
            <b>Where do we hold the offsite?</b>
            {(
              [
                ["Lisbon", 62],
                ["Ghent", 24],
                ["Remote, again", 14],
              ] as const
            ).map(([option, percent]) => (
              <div key={option} className="w-opt">
                <span>{option}</span>
                <span>{percent}%</span>
                <i style={{ width: `${percent}%` }} />
              </div>
            ))}
            <small>21 votes · closes Friday</small>
          </div>
        </div>
      );
    case "notes":
      return (
        <div className={`w w-notes ${c}`} data-testid="fake-widget">
          <div className="w-notes-in">
            <b>Design crit, 14 Nov</b>
            {[90, 72, 84, 40, 0, 66, 88, 58].map((width, i) => (width ? <i key={i} style={{ width: `${width}%` }} /> : <u key={i} />))}
          </div>
        </div>
      );
    case "timer":
      return (
        <div className={`w w-timer ${c}`} data-testid="fake-widget">
          <div>
            <b>12:47</b>
            <small>Break ends at 14:30</small>
          </div>
        </div>
      );
    default:
      return (
        <div className={`w w-call ${c}`} style={{ display: "grid", placeItems: "center" }} data-testid="fake-widget">
          <span style={{ opacity: 0.7 }}>{name} (widget content)</span>
        </div>
      );
  }
}

/** The size of a story's screenshot, `parameters.size` (`.storybook/preview.tsx`): a full screen by default. */
export const DEFAULT_STORY_SIZE: readonly [number, number] = [1280, 800];
export const storySize = (parameters: Parameters): readonly [number, number] => (parameters.size as [number, number] | undefined) ?? DEFAULT_STORY_SIZE;

/**
 * The stage of the side panel stories: `parameters.size` wide and high (348 × 620 in most) with
 * 12px padding, so the column is 324px wide. `parameters.fence`: the DevBackend background.
 */
export const SideStage: Decorator = (Story, { parameters }) => {
  const [width, height] = storySize(parameters);
  return (
    <div className={`stage ${parameters.fence ? "fence" : ""}`} style={{ width, height }}>
      <div className="sidecol">
        <Story />
      </div>
    </div>
  );
};

/** For play functions: set the value of a text field as typing does (React sees an `input` event). */
export function fillIn(field: HTMLElement, value: string) {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * For play functions: the first element of `selector` in `root` whose text includes `text`, as soon as there is one
 * (it waits as `findBy…` does). Throws when there is none: a play function that missed its element would draw another
 * state without telling. Prefer `within(canvasElement).findByRole(…)` where the element has a fitting name.
 */
export const findElement = <T extends HTMLElement = HTMLElement>(root: HTMLElement, selector: string, text = ""): Promise<T> =>
  waitFor(() => {
    const found = Array.from(root.querySelectorAll<T>(selector)).find((el) => el.textContent?.includes(text));
    if (!found) throw new Error(`no ${selector}${text ? ` containing "${text}"` : ""}`);
    return found;
  });
