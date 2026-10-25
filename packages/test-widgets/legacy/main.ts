/**
 * Legacy test widget (matrix-widget-api). Requests the default capabilities and calls `start()`
 * on load (unless `?autostart=0`); everything else is a button. Incoming toWidget actions are
 * logged; `send_event` and `update_state` are acknowledged so the host does not see errors.
 */
import { WidgetApi, type IWidgetApiRequest } from "matrix-widget-api";

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
for (const action of ["send_event", "update_state"]) {
  api.on(`action:${action}`, (ev: CustomEvent<IWidgetApiRequest>) => {
    ev.preventDefault();
    api.transport.reply(ev.detail, {});
  });
}

mount("Legacy test widget (matrix-widget-api)", [
  input("caps", `${DEFAULT_CAPABILITIES},${DELAYED_CAPABILITIES}`, "capabilities"),
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
  button("send m.room.message", () => api.sendRoomEvent("m.room.message", { msgtype: "m.text", body: valueOf("body") })),
  button("send state m.room.topic", () => api.sendStateEvent("m.room.topic", "", { topic: valueOf("body") })),
  button("send delayed m.room.message (5s)", () =>
    api.sendRoomEvent("m.room.message", { msgtype: "m.text", body: valueOf("body") }, undefined, 5000).then(rememberDelay),
  ),
  button("delayed: restart", () => api.restartScheduledDelayedEvent(lastDelay.id)),
  button("delayed: send now", () => api.sendScheduledDelayedEvent(lastDelay.id)),
  button("delayed: cancel", () => api.cancelScheduledDelayedEvent(lastDelay.id)),
  button("send sticky m.rtc.member (30s)", () => api.sendRoomEvent("m.rtc.member", { from: "legacy widget" }, undefined, undefined, 30000)),
  button("read m.room.message (limit 10)", () => api.readRoomEvents("m.room.message", 10)),
  button("read state m.room.topic", () => api.readStateEvents("m.room.topic", undefined, "")),
  button("custom action org.example.custom", () => api.transport.send("org.example.custom" as never, { hello: "world" })),
]);
refresh();
if (params.get("autostart") !== "0") (document.querySelector("#controls button") as HTMLButtonElement).click();
