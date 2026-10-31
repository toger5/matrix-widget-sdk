/**
 * Legacy test widget (matrix-widget-api). Requests the default capabilities and calls `start()`
 * on load (unless `?autostart=0`); everything else is a button. Incoming toWidget actions are
 * logged; `send_event` and `update_state` are acknowledged so the host does not see errors.
 */
import { WidgetApi, type IWidgetApiRequest } from "matrix-widget-api";

import {
  DEFAULT_CAPABILITIES,
  DELAYED_CAPABILITIES,
  EXTRA_CAPABILITIES,
  RELATION_CAPABILITIES,
  TO_DEVICE_CAPABILITIES,
  TO_DEVICE_MESSAGES,
  button,
  capabilityList,
  fileControls,
  input,
  lastDelay,
  lastEvent,
  log,
  mount,
  reactionTo,
  rememberDelay,
  rememberEvent,
  showState,
  valueOf,
} from "../shared/ui";

const params = new URLSearchParams(location.search);
const widgetId = params.get("widgetId");
const parentUrl = params.get("parentUrl");
// Like Element widgets: postMessage only to the origin named by `parentUrl` (the host, or the
// compat wrapper, which rewrites the parameter to itself).
const api = new WidgetApi(widgetId, parentUrl ? new URL(parentUrl).origin : "*");
// `urlParams` shows what the (wrapper's) templating produced, e.g. `baseUrl`, `userId`.
const state = { urlParams: Object.fromEntries(params), started: false, ready: false, approved: [] as string[], clientVersions: [] as string[] };
console.log("[legacy test widget] url params", JSON.stringify(state.urlParams));
const refresh = () => showState(state);

api.transport.on("message", (ev: CustomEvent<IWidgetApiRequest>) => log("toWidget", ev.detail));
api.on("ready", () => ((state.ready = true), refresh()));
api.on("action:notify_capabilities", (ev: CustomEvent<IWidgetApiRequest>) => {
  state.approved = (ev.detail.data as { approved: string[] }).approved;
  refresh();
});
for (const action of ["send_event", "update_state", "send_to_device", "update_turn_servers", "theme_change", "language_change", "visibility"]) {
  api.on(`action:${action}`, (ev: CustomEvent<IWidgetApiRequest>) => {
    ev.preventDefault();
    api.transport.reply(ev.detail, {});
  });
}

mount("Legacy test widget (matrix-widget-api)", [
  input(
    "caps",
    `${DEFAULT_CAPABILITIES},${DELAYED_CAPABILITIES},${RELATION_CAPABILITIES},${TO_DEVICE_CAPABILITIES},${EXTRA_CAPABILITIES}`,
    "capabilities",
  ),
  button("start (requests capabilities above)", () => {
    api.requestCapabilities(capabilityList());
    api.start();
    state.started = true;
    refresh();
    return api.getClientVersions().then((v) => ((state.clientVersions = v), refresh(), v));
  }),
  button("content_loaded", () => api.sendContentLoaded()),
  button("renegotiate capabilities (MSC2974)", () => (api.requestCapabilities(capabilityList()), api.updateRequestedCapabilities())),
  input("body", "hello from the legacy widget", "message body"),
  button("send m.room.message", () => api.sendRoomEvent("m.room.message", { msgtype: "m.text", body: valueOf("body") }).then(rememberEvent)),
  button("react 👍 to last message", () => api.sendRoomEvent("m.reaction", reactionTo(lastEvent.id, "👍"))),
  button("read relations of last message", () => api.readEventRelations(lastEvent.id, undefined, undefined, undefined, 10)),
  button("send state m.room.topic", () => api.sendStateEvent("m.room.topic", "", { topic: valueOf("body") })),
  button("send delayed m.room.message (5s)", () =>
    api.sendRoomEvent("m.room.message", { msgtype: "m.text", body: valueOf("body") }, undefined, 5000).then(rememberDelay),
  ),
  button("delayed: restart", () => api.restartScheduledDelayedEvent(lastDelay.id)),
  button("delayed: send now", () => api.sendScheduledDelayedEvent(lastDelay.id)),
  button("delayed: cancel", () => api.cancelScheduledDelayedEvent(lastDelay.id)),
  button("send sticky m.rtc.member (30s)", () => api.sendRoomEvent("m.rtc.member", { from: "legacy widget" }, undefined, undefined, 30000)),
  button("send to-device org.example.ping", () => api.sendToDevice("org.example.ping", false, TO_DEVICE_MESSAGES)),
  button("read m.room.message (limit 10)", () => api.readRoomEvents("m.room.message", 10)),
  button("read state m.room.topic", () => api.readStateEvents("m.room.topic", undefined, "")),
  button("get_openid", () => api.requestOpenIDConnectToken()),
  button("navigate to matrix.to", () => api.navigateTo("https://matrix.to/#/#matrix:matrix.org")),
  button("set_always_on_screen true", () => api.setAlwaysOnScreen(true)),
  button("watch_turn_servers (logs the first)", async () => {
    for await (const server of api.getTurnServers()) return server;
  }),
  button("get_rtc_transports", () => api.getRtcTransports()),
  button("user_directory_search 'ali'", () => api.searchUserDirectory("ali", 10)),
  button("get_media_config", () => api.getMediaConfig()),
  ...fileControls({
    // The compat wrapper turns the host's base64 back into a Blob, as legacy hosts sent it.
    download: async (contentUri) => new Response((await api.downloadFile(contentUri)).file).blob(),
    upload: async (file) => (await api.uploadFile(file)).content_uri,
  }),
  button("read_room_account_data m.tag", () => api.readRoomAccountData("m.tag")),
  button("rtc_livekit_get_token", () =>
    api.getRtcLivekitToken({ server_name: "example.org", url: "https://livekit.example.org", room_id: "!room:example.org", slot_id: "slot", member_id: "member" }),
  ),
  button("custom action org.example.custom", () => api.transport.send("org.example.custom" as never, { hello: "world" })),
]);
refresh();
if (params.get("autostart") !== "0") (document.querySelector("#controls button") as HTMLButtonElement).click();
