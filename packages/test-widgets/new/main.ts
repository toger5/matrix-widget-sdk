/**
 * MSC4412 test widget on widget-base-sdk (wasm). Connects to the parent on load; requesting
 * capabilities and `notify_ready` are buttons (clicked automatically unless `?autostart=0`).
 */
import init, { WidgetApi, initLogging } from "widget-base-sdk";

import {
  DEFAULT_CAPABILITIES,
  DELAYED_CAPABILITIES,
  EXTRA_CAPABILITIES,
  RELATION_CAPABILITIES,
  TO_DEVICE_CAPABILITIES,
  WEBVIEW_CAPABILITIES,
} from "./capabilities";
import {
  TO_DEVICE_MESSAGES,
  button,
  capabilityList,
  el,
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

await init();
// `?log=<level>&logFilter=<RUST_LOG spec>`: what the SDK writes to the console (default: warn).
const params = new URLSearchParams(location.search);
if (params.get("log")) initLogging(params.get("log")!, params.get("logFilter"));
const api = WidgetApi.connectToParent();
const refresh = () => showState(api.state);

api.onEvent((event: unknown) => (log("forward_event", event), refresh()));
api.onStateUpdate((state: unknown) => (log("update_state", state), refresh()));
api.onToDeviceMessage((message: unknown) => log("forward_to_device", message));
api.onTurnServer((server: unknown) => log("update_turn_servers", server));
api.onThemeChange((theme: unknown) => log("update_theme", theme));
api.onLanguageChange((lang: string) => log("update_language", lang));
api.onVisibilityChange((visible: boolean) => log("update_visibility", visible));
api.onCapabilitiesChanged((allowed: string[]) => (log("update_capabilities", { allowed }), refresh()));

const content = () => ({ msgtype: "m.text", body: valueOf("body") });

/** The Permissions Policy features this widget's iframe may use, as Chromium reports them (`document.featurePolicy`). */
const FEATURES = ["camera", "microphone", "display-capture", "clipboard-write", "fullscreen", "autoplay"];
const featurePolicy = () => {
  const policy = (document as Document & { featurePolicy?: { allowsFeature(feature: string): boolean } }).featurePolicy;
  if (!policy) throw new Error("this browser has no document.featurePolicy");
  return Object.fromEntries(FEATURES.map((feature) => [feature, policy.allowsFeature(feature)]));
};

/** The webview row: browser permissions of the iframe (webview capabilities), and what the iframe may do. */
const webviewControls = (): Node[] => [
  el("h3", { textContent: "webview" }),
  button("webview: request camera + microphone", () => api.requestCapabilities(WEBVIEW_CAPABILITIES.split(",")).finally(refresh)),
  button("webview: try camera", async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach((track) => track.stop());
    return { camera: "allowed" };
  }),
  button("webview: open popup", () => {
    const popup = window.open("about:blank", "_blank");
    popup?.close();
    return { popup: popup ? "opened" : "blocked" };
  }),
  button("webview: feature policy", featurePolicy),
];
mount("MSC4412 test widget (widget-base-sdk)", [
  input(
    "caps",
    `${DEFAULT_CAPABILITIES},${DELAYED_CAPABILITIES},${RELATION_CAPABILITIES},${TO_DEVICE_CAPABILITIES},${EXTRA_CAPABILITIES}`,
    "capabilities",
  ),
  button("request_capabilities", () => api.requestCapabilities(capabilityList()).finally(refresh)),
  button("notify_ready", () => api.notifyReady().finally(refresh)),
  input("body", "hello from the new widget", "message body"),
  button("send m.room.message", () => api.sendEvent("m.room.message", content()).then(rememberEvent)),
  button("react 👍 to last message", () => api.sendEvent("m.reaction", reactionTo(lastEvent.id, "👍"))),
  button("read relations of last message", () => api.readRelations(lastEvent.id, undefined, undefined, 10)),
  button("send state m.room.topic", () => api.sendStateEvent("m.room.topic", "", { topic: valueOf("body") })),
  button("send delayed m.room.message (5s)", () => api.sendDelayedEvent("m.room.message", undefined, content(), 5000).then(rememberDelay)),
  button("delayed: restart", () => api.updateDelayedEvent(lastDelay.id, "restart")),
  button("delayed: send now", () => api.updateDelayedEvent(lastDelay.id, "send")),
  button("delayed: cancel", () => api.updateDelayedEvent(lastDelay.id, "cancel")),
  button("send sticky m.rtc.member (30s)", () => api.sendStickyEvent("m.rtc.member", { from: "new widget" }, 30000)),
  button("send to-device org.example.ping", () => api.sendToDevice("org.example.ping", false, TO_DEVICE_MESSAGES)),
  button("read m.room.message (limit 10)", () => api.readEvents("m.room.message", 10)),
  button("read state m.room.topic", () => api.readState("m.room.topic", undefined)),
  button("get_openid", () => api.requestOpenIdToken()),
  button("navigate to matrix.to", () => api.navigate("https://matrix.to/#/#matrix:matrix.org")),
  button("set_always_on_screen true", () => api.setAlwaysOnScreen(true)),
  button("watch_turn_servers", () => api.watchTurnServers()),
  button("unwatch_turn_servers", () => api.unwatchTurnServers()),
  button("get_rtc_transports", () => api.getRtcTransports()),
  button("search_user_directory 'ali'", () => api.searchUserDirectory("ali", 10)),
  button("get_media_config", () => api.getMediaConfig()),
  ...fileControls({
    async download(contentUri) {
      const { data, mimetype } = (await api.downloadFile(contentUri)) as { data: Uint8Array<ArrayBuffer>; mimetype?: string };
      return new Blob([data], { type: mimetype ?? "" });
    },
    async upload(file) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return ((await api.uploadFile(bytes, file.type || undefined)) as { content_uri: string }).content_uri;
    },
  }),
  button("read_room_account_data m.tag", () => api.readRoomAccountData("m.tag")),
  button("get_rtc_livekit_token", () =>
    api.getRtcLivekitToken({ server_name: "example.org", url: "https://livekit.example.org", room_id: "!room:example.org", slot_id: "slot", member_id: "member" }),
  ),
  button("get_matrix_context", () => api.getMatrixContext()),
  button("get_client_context", () => api.getClientContext()),
  ...webviewControls(),
]);
refresh();
if (new URLSearchParams(location.search).get("autostart") !== "0") {
  const [requestCaps, notifyReady] = document.querySelectorAll<HTMLButtonElement>("#controls button");
  requestCaps.click();
  notifyReady.click();
}
