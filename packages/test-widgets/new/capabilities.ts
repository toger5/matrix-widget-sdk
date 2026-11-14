/**
 * The capabilities the MSC4412 test widget requests, one per action
 * (`docs/spec-appendix/capability-naming-proposal.md`):
 *
 *     source ":" namespace "." action [ "." modifier ] [ ":" data ]
 */

const widget = (rest: string): string => `widget:org.matrix.mscXXXX.${rest}`;
const host = (rest: string): string => `host:org.matrix.mscXXXX.${rest}`;

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
