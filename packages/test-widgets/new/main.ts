/**
 * MSC4412 test widget on widget-base-sdk (wasm). Connects to the parent on load; requesting
 * capabilities and `content_loaded` are buttons (clicked automatically unless `?autostart=0`).
 */
import init, { WidgetApi } from "widget-base-sdk";

import {
  DEFAULT_CAPABILITIES,
  DELAYED_CAPABILITIES,
  button,
  capabilityList,
  input,
  lastDelay,
  log,
  mount,
  rememberDelay,
  showState,
  valueOf,
} from "../shared/ui";

await init();
const api = WidgetApi.connectToParent();
const refresh = () => showState(api.state);

api.onEvent((event: unknown) => (log("send_event", event), refresh()));
api.onStateUpdate((state: unknown) => (log("update_state", state), refresh()));
api.onCapabilitiesChanged((requested: string[], approved: string[]) => (log("notify_capabilities", { requested, approved }), refresh()));

const content = () => ({ msgtype: "m.text", body: valueOf("body") });
mount("MSC4412 test widget (widget-base-sdk)", [
  input(
    "caps",
    `${DEFAULT_CAPABILITIES},${DELAYED_CAPABILITIES},org.matrix.msc4412.matrix_context,org.matrix.msc4412.client_context`,
    "capabilities",
  ),
  button("request_capabilities", () => api.requestCapabilities(capabilityList()).finally(refresh)),
  button("content_loaded", () => api.contentLoaded().finally(refresh)),
  input("body", "hello from the new widget", "message body"),
  button("send m.room.message", () => api.sendEvent("m.room.message", content())),
  button("send state m.room.topic", () => api.sendStateEvent("m.room.topic", "", { topic: valueOf("body") })),
  button("send delayed m.room.message (5s)", () => api.sendDelayedEvent("m.room.message", undefined, content(), 5000).then(rememberDelay)),
  button("delayed: restart", () => api.updateDelayedEvent(lastDelay.id, "restart")),
  button("delayed: send now", () => api.updateDelayedEvent(lastDelay.id, "send")),
  button("delayed: cancel", () => api.updateDelayedEvent(lastDelay.id, "cancel")),
  button("send sticky m.rtc.member (30s)", () => api.sendStickyEvent("m.rtc.member", { from: "new widget" }, 30000)),
  button("read m.room.message (limit 10)", () => api.readEvents("m.room.message", 10)),
  button("read state m.room.topic", () => api.readState("m.room.topic", undefined)),
  button("matrix_context", () => api.getMatrixContext()),
  button("client_context", () => api.getClientContext()),
]);
refresh();
if (new URLSearchParams(location.search).get("autostart") !== "0") {
  const [requestCaps, contentLoaded] = document.querySelectorAll<HTMLButtonElement>("#controls button");
  requestCaps.click();
  contentLoaded.click();
}
