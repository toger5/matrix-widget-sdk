/**
 * The capabilities the legacy test widget requests, in matrix-widget-api's names. The compat
 * wrapper translates them for the host (`packages/widget-compat-wrapper/src/capabilities.ts`).
 */

export const DEFAULT_CAPABILITIES = [
  "org.matrix.msc2762.send.event:m.room.message",
  "org.matrix.msc2762.receive.event:m.room.message",
  "org.matrix.msc2762.send.state_event:m.room.topic",
  "org.matrix.msc2762.receive.state_event:m.room.topic",
].join(",");

/** Delayed (MSC4157) and sticky (MSC4407) sends, exercised by both widgets' extra buttons. */
export const DELAYED_CAPABILITIES = [
  "org.matrix.msc4157.send.delayed_event",
  "org.matrix.msc4157.update_delayed_event",
  "org.matrix.msc4407.send.sticky_event",
  "org.matrix.msc2762.send.event:m.rtc.member",
].join(",");

/** Reactions (MSC3869 relations) between the test widgets' own messages. */
export const RELATION_CAPABILITIES = [
  "org.matrix.msc2762.send.event:m.reaction",
  "org.matrix.msc2762.receive.event:m.reaction",
].join(",");

/** To-device messages (MSC3819) of one test type, both directions. */
export const TO_DEVICE_CAPABILITIES = [
  "org.matrix.msc3819.send.to_device:org.example.ping",
  "org.matrix.msc3819.receive.to_device:org.example.ping",
].join(",");

/** The read-style extras: TURN, RTC transports, user directory, media config, room account data, LiveKit. */
export const EXTRA_CAPABILITIES = [
  "town.robin.msc3846.turn_servers",
  "org.matrix.msc4515.rtc_transports",
  "org.matrix.msc3973.user_directory_search",
  "org.matrix.msc4039.upload_file",
  "org.matrix.msc4039.download_file",
  "com.beeper.capabilities.receive.room_account_data:m.tag",
  "org.matrix.msc4533.rtc_livekit_get_token",
  "org.matrix.msc2931.navigate",
  "m.always_on_screen",
].join(",");
