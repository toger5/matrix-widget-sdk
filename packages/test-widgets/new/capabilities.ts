/**
 * The capabilities the MSC4412 test widget requests, one per action (MSC4412 "Capability format",
 * `docs/spec-appendix/capability-naming-proposal.md`). A capability embeds the wire name of its
 * action, unstable namespace included:
 *
 *     source ":" action [ "." modifier ] [ ":" data ]          action = namespace "." name
 */

/** Unstable namespace of each action that has an MSC; every other action uses the placeholder. */
const NAMESPACES: Record<string, string> = {
  read_events: "org.matrix.msc2876",
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
const namespace = (rest: string): string => NAMESPACES[/^[^.:]*/.exec(rest)![0]] ?? "org.matrix.mscXXXX";

const widget = (rest: string): string => `widget:${namespace(rest)}.${rest}`;
const host = (rest: string): string => `host:${namespace(rest)}.${rest}`;
/** A webview capability (`sandbox:<token>`, `allow:<feature>`): about the iframe, not an action; the namespace of its MSC draft. */
const webview = (rest: string): string => `webview:org.matrix.mscXXXX.${rest}`;

/** Messages and the room topic: send, read, and be told about new ones. */
export const DEFAULT_CAPABILITIES = [
  widget("send_event.timeline:m.room.message"),
  widget("read_events.timeline:m.room.message"),
  host("forward_event.timeline:m.room.message"),
  widget("send_event.state:m.room.topic"),
  widget("read_events.state:m.room.topic"),
  host("update_state:m.room.topic"),
  host("forward_event.state:m.room.topic"),
].join(",");

/** Delayed (MSC4157) and sticky (MSC4407) sends. */
export const DELAYED_CAPABILITIES = [
  widget("send_event.delayed"),
  widget("update_delayed_event"),
  widget("send_event.sticky"),
  widget("send_event.timeline:m.rtc.member"),
].join(",");

/** Reactions (MSC3869 relations) between the test widgets' own messages. */
export const RELATION_CAPABILITIES = [
  widget("send_event.timeline:m.reaction"),
  widget("read_events.timeline:m.reaction"),
  widget("read_relations:m.reaction"),
  host("forward_event.timeline:m.reaction"),
].join(",");

/** To-device messages (MSC3819) of one test type, both directions. */
export const TO_DEVICE_CAPABILITIES = [
  widget("send_to_device:org.example.ping"),
  host("forward_to_device:org.example.ping"),
].join(",");

/** Everything else the widget has a button for. */
export const EXTRA_CAPABILITIES = [
  host("update_turn_servers"),
  widget("get_rtc_transports"),
  widget("search_user_directory"),
  widget("get_media_config"),
  widget("upload_file"),
  widget("download_file"),
  widget("read_room_account_data:m.tag"),
  widget("get_rtc_livekit_token"),
  widget("navigate"),
  widget("set_always_on_screen"),
  widget("get_openid"),
  widget("get_matrix_context"),
  widget("get_client_context"),
  host("update_theme"),
  host("update_language"),
  host("update_visibility"),
].join(",");

/**
 * Browser permissions of the widget's iframe (webview capabilities): camera and microphone. Not part
 * of the list above, so the widget runs in the host's strict default iframe until the "webview" buttons
 * request them; the host restarts the widget to apply a grant.
 */
export const WEBVIEW_CAPABILITIES = [webview("allow:camera"), webview("allow:microphone")].join(",");
