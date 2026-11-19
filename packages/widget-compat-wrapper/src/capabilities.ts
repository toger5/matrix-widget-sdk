/**
 * Capability translation between a legacy widget and an MSC4412 host.
 *
 * The host knows one capability per action (`docs/spec-appendix/capability-naming-proposal.md`),
 * which embeds the action's wire name:
 *
 *     source ":" action [ "." modifier ] [ ":" data ]          action = namespace "." name
 *     widget:org.matrix.mscXXXX.send_event.timeline:m.room.message
 *
 * Every legacy capability maps to a fixed set of new ones ({@link expandLegacyCapability}). The
 * wrapper requests that set and reports the legacy capability as approved only when the host
 * approved the whole set ({@link collapseApproved}).
 */
import { PLACEHOLDER } from "./envelope";

/**
 * The unstable namespace of each action that has an MSC; every other action uses the placeholder.
 * Must match `namespace_of` in `crates/matrix-widget-actions/src/capabilities.rs`.
 */
const ACTION_NAMESPACES: Record<string, string> = {
  read_relations: "org.matrix.msc3869",
  update_delayed_event: "org.matrix.msc4157",
  get_rtc_transports: "org.matrix.msc4515",
  search_user_directory: "org.matrix.msc3973",
  get_media_config: "org.matrix.msc4039",
  upload_file: "org.matrix.msc4039",
  download_file: "org.matrix.msc4039",
  get_rtc_livekit_token: "org.matrix.msc4533",
  delegate_rtc_livekit_delayed_leave: "org.matrix.msc4533",
  navigate: "org.matrix.msc2931",
  read_room_account_data: "com.beeper",
};

/** The unstable namespace of the action that `rest` (`action[.modifier][:data]`) starts with. */
function namespaceOf(rest: string): string {
  const action = /^[^.:]*/.exec(rest)![0];
  return Object.hasOwn(ACTION_NAMESPACES, action) ? ACTION_NAMESPACES[action] : PLACEHOLDER;
}

/** A capability for an action the widget sends; `rest` is `action[.modifier][:data]`. */
export const widgetCapability = (rest: string): string => `widget:${namespaceOf(rest)}.${rest}`;
/** A capability for an action the host sends (a subscription). */
export const hostCapability = (rest: string): string => `host:${namespaceOf(rest)}.${rest}`;
/** A capability of the widget's iframe; `rest` is `sandbox:<token>` or `allow:<feature>` (`spec/patch/new/webview-capabilities.md`). */
export const webviewCapability = (rest: string): string => `webview:${PLACEHOLDER}.${rest}`;

/** The `sandbox` tokens Element Web gives every widget iframe (`AppTile`): what legacy widgets were written for. */
export const LEGACY_SANDBOX: readonly string[] = [
  "allow-forms",
  "allow-popups",
  "allow-popups-to-escape-sandbox",
  "allow-same-origin",
  "allow-scripts",
  "allow-presentation",
  "allow-downloads",
];
/** The `allow` features Element Web gives every widget iframe (`AppTile`), plus `fullscreen` (its `allowFullscreen`). */
export const LEGACY_ALLOW: readonly string[] = [
  "microphone",
  "camera",
  "encrypted-media",
  "autoplay",
  "display-capture",
  "clipboard-write",
  "clipboard-read",
  "fullscreen",
];

/**
 * The webview capabilities the wrapper requests when it starts: a legacy client's iframe. A host
 * that keeps legacy widgets working grants them unasked from the start, so no reload is needed.
 */
export const LEGACY_WEBVIEW_CAPABILITIES: readonly string[] = [
  ...LEGACY_SANDBOX.map((token) => webviewCapability(`sandbox:${token}`)),
  ...LEGACY_ALLOW.map((feature) => webviewCapability(`allow:${feature}`)),
];

/**
 * Always requested: the legacy api sends these without a capability. (`get_openid` needs none in
 * the legacy api either, but it is granted per token, so the bridge requests it per token.)
 */
export const IMPLICIT_CAPABILITIES: readonly string[] = [
  hostCapability("update_theme"),
  hostCapability("update_language"),
  hostCapability("update_visibility"),
];

/** Every legacy capability may be spelled with this instead of its MSC's prefix. */
const LEGACY_STABLE_PREFIX = "m.";
const MSC2762 = "org.matrix.msc2762.";
const MSC3819 = "org.matrix.msc3819.";
const MSC4157 = "org.matrix.msc4157.";
const MSC4407 = "org.matrix.msc4407.";

interface LegacyRule {
  /** The legacy capability's unstable prefix (the stable `m.` is accepted as well). */
  prefix: string;
  /** What follows the prefix. Ends with `:` when the capability carries data (an event type). */
  body: string;
  /** The new capabilities, given the data (empty for capabilities without data). */
  expand(data: string): string[];
}

const unit = (prefix: string, body: string, ...expansion: string[]): LegacyRule => ({ prefix, body, expand: () => expansion });

/** The migration table of the naming proposal. `<type>` keeps its `#<msgtype>` / `#<state_key>` suffix. */
const LEGACY_RULES: LegacyRule[] = [
  { prefix: MSC2762, body: "send.event:", expand: (t) => [widgetCapability(`send_event.timeline:${t}`)] },
  { prefix: MSC2762, body: "send.state_event:", expand: (t) => [widgetCapability(`send_event.state:${t}`)] },
  {
    // Reading (the legacy `read_events`, readEvents.ts), relations and new events.
    prefix: MSC2762,
    body: "receive.event:",
    expand: (t) => [
      widgetCapability(`read_timeline:${t}`),
      widgetCapability(`read_relations:${t}`),
      hostCapability(`forward_event.timeline:${t}`),
      widgetCapability("paginate_timeline"),
      hostCapability("notify_timeline_update"),
    ],
  },
  {
    // `update_state` also answers legacy state reads (readEvents.ts).
    prefix: MSC2762,
    body: "receive.state_event:",
    expand: (t) => [
      hostCapability(`update_state:${t}`),
      hostCapability(`forward_event.state:${t}`),
    ],
  },
  // One widget, one room: never requested, never reported as approved.
  { prefix: MSC2762, body: "timeline:", expand: () => [] },
  { prefix: MSC3819, body: "send.to_device:", expand: (t) => [widgetCapability(`send_to_device:${t}`)] },
  { prefix: MSC3819, body: "receive.to_device:", expand: (t) => [hostCapability(`forward_to_device:${t}`)] },
  {
    prefix: "com.beeper.capabilities.",
    body: "receive.room_account_data:",
    expand: (t) => [widgetCapability(`read_room_account_data:${t}`)],
  },
  unit(MSC4157, "send.delayed_event", widgetCapability("send_event.delayed")),
  unit(MSC4157, "update_delayed_event", widgetCapability("update_delayed_event")),
  unit(MSC4407, "send.sticky_event", widgetCapability("send_event.sticky")),
  unit(MSC4407, "receive.sticky_event", hostCapability("forward_event.sticky")),
  unit("town.robin.msc3846.", "turn_servers", hostCapability("update_turn_servers")),
  unit("org.matrix.msc4515.", "rtc_transports", widgetCapability("get_rtc_transports")),
  unit("org.matrix.msc3973.", "user_directory_search", widgetCapability("search_user_directory")),
  // An uploader needs the media config, so the legacy upload capability covered both.
  unit("org.matrix.msc4039.", "upload_file", widgetCapability("upload_file"), widgetCapability("get_media_config")),
  unit("org.matrix.msc4039.", "download_file", widgetCapability("download_file")),
  unit("org.matrix.msc2931.", "navigate", widgetCapability("navigate")),
  unit("org.matrix.msc4533.", "rtc_livekit_get_token", widgetCapability("get_rtc_livekit_token")),
  unit("org.matrix.msc4533.", "rtc_livekit_delegate_delayed_leave", widgetCapability("delegate_rtc_livekit_delayed_leave")),
  // Only ever had a stable spelling.
  unit(LEGACY_STABLE_PREFIX, "always_on_screen", widgetCapability("set_always_on_screen")),
];

/**
 * The new capabilities one legacy capability stands for. A `webview:` capability expands to
 * nothing: the inner iframe's attributes are constant (`wrapper.ts`), a grant would only reload
 * the wrapper. Unknown strings pass through unchanged, so the host decides about them.
 */
export function expandLegacyCapability(legacy: string): string[] {
  if (legacy.startsWith("webview:")) return [];
  for (const rule of LEGACY_RULES) {
    for (const prefix of [rule.prefix, LEGACY_STABLE_PREFIX]) {
      if (!legacy.startsWith(prefix + rule.body)) continue;
      const data = legacy.slice(prefix.length + rule.body.length);
      const typed = rule.body.endsWith(":");
      // A typed capability needs a type; an untyped one must end right after its body.
      if (typed ? data !== "" : data === "") return rule.expand(data);
    }
  }
  return [legacy];
}

/** Everything to request from the host for a legacy widget's capability list, without duplicates. */
export function capabilitiesToRequest(legacy: readonly string[]): string[] {
  return [...new Set([...IMPLICIT_CAPABILITIES, ...legacy.flatMap(expandLegacyCapability)])];
}

/**
 * A capability with the stable namespace `m` rewritten to its action's unstable one, so that
 * `widget:m.navigate` equals `widget:org.matrix.msc2931.navigate`. Other strings are unchanged.
 */
export function normalizeCapability(capability: string): string {
  const match = /^(widget|host|webview):m\./.exec(capability);
  if (!match) return capability;
  const rest = capability.slice(match[0].length);
  return match[1] === "webview" ? webviewCapability(rest) : `${match[1]}:${namespaceOf(rest)}.${rest}`;
}

/**
 * The legacy capabilities out of `legacyRequested` that `approved` grants: those whose whole,
 * non-empty expansion is approved (a widget told it holds `receive.event:<type>` expects all of it).
 */
export function collapseApproved(legacyRequested: readonly string[], approved: readonly string[]): string[] {
  const held = new Set(approved.map(normalizeCapability));
  return [...new Set(legacyRequested)].filter((legacy) => {
    const expansion = expandLegacyCapability(legacy);
    return expansion.length > 0 && expansion.every((capability) => held.has(normalizeCapability(capability)));
  });
}
