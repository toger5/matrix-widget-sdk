import init, { WidgetHost } from "widget-host-driver";

import { resolveWidget, type StateEvent } from "./widgets";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const value = (id: string) => $<HTMLInputElement>(id).value;
const checked = (id: string) => $<HTMLInputElement>(id).checked;
const show = (id: string, data: unknown) => ($(id).textContent = JSON.stringify(data, null, 2));
const pretty = (data: unknown) => (typeof data === "string" ? data : JSON.stringify(data));

const EXAMPLE_NEW: StateEvent = {
  type: "m.widget",
  state_key: "widget-1",
  content: { name: "New test widget", url: "http://localhost:5175/new/", usesWidgetAPI: true },
};
const EXAMPLE_LEGACY: StateEvent = {
  type: "im.vector.modular.widgets",
  state_key: "widget-1",
  content: {
    type: "m.custom",
    name: "Legacy test widget",
    // Template variables are resolved by the compat wrapper, not by this host. The base url
    // variable produces a nested `https://` inside the already nested legacy url.
    url: "http://localhost:5175/legacy/?title=$title&widgetId=$matrix_widget_id&userId=$matrix_user_id&baseUrl=$org.matrix.msc4039.matrix_base_url&theme=$org.matrix.msc2873.client_theme",
    waitForIframeLoad: true,
    creatorUserId: "@alice:example.org",
    data: { title: "Notes & more" },
  },
};
const EXAMPLE_EVENT = {
  type: "m.room.message",
  sender: "@bob:example.org",
  event_id: "$injected-1",
  room_id: "!room:example.org",
  origin_server_ts: 1,
  content: { msgtype: "m.text", body: "hello from the host" },
};

let host: WidgetHost | undefined;
let iframe: HTMLIFrameElement | undefined;
let widgetOrigin = "*";

function log(kind: "in" | "out" | "err" | "info", data: unknown) {
  const line = document.createElement("pre");
  line.className = kind;
  line.textContent = `${new Date().toISOString().slice(11, 23)} ${{ in: "← widget", out: "→ widget", err: "error", info: "info" }[kind]} ${pretty(data)}`;
  $("log").prepend(line);
}

function refresh() {
  if (!host) return;
  show("snapshot", host.snapshot);
  show("timeline", host.timeline);
  show("state", host.state);
}

function askCapabilities(requested: string[]) {
  if (checked("autoApprove")) return host?.approveCapabilities(requested);
  const box = $("caps");
  box.replaceChildren("Widget requests capabilities:");
  const inputs = requested.map((cap) => {
    const input = Object.assign(document.createElement("input"), { type: "checkbox", checked: true, value: cap });
    const label = document.createElement("label");
    label.append(input, ` ${cap}`);
    box.append(label);
    return input;
  });
  const approve = Object.assign(document.createElement("button"), { textContent: "Approve selected" });
  approve.onclick = () => {
    host?.approveCapabilities(inputs.filter((i) => i.checked).map((i) => i.value));
    box.replaceChildren();
    refresh();
  };
  box.append(approve);
}

function loadWidget() {
  const widget = resolveWidget(JSON.parse(value("event")) as StateEvent, value("wrapper"));
  $("decision").textContent = `${widget.legacy ? "legacy event → compat wrapper" : "MSC4411 event → direct"}\n${widget.url}`;

  iframe?.remove();
  $("caps").replaceChildren();
  host = new WidgetHost(value("room"), value("user"));
  host.setClientContext("widget-test-host", "light", "en");
  widgetOrigin = new URL(widget.url).origin;
  iframe = Object.assign(document.createElement("iframe"), { src: widget.url, hidden: widget.usesWidgetApi });
  $("spinner").hidden = !widget.usesWidgetApi;

  host.onSendToWidget((json: string) => {
    const message = JSON.parse(json);
    log("out", message);
    iframe?.contentWindow?.postMessage(message, widgetOrigin);
  });
  host.onCapabilitiesRequested((caps: string[]) => askCapabilities(caps));
  host.onContentLoaded(() => {
    $("spinner").hidden = true;
    if (iframe) iframe.hidden = false;
  });
  $("frame").querySelector(".fill")!.append(iframe);
  refresh();
}

window.addEventListener("message", (ev) => {
  if (!host || !iframe || ev.source !== iframe.contentWindow) return;
  log("in", ev.data);
  host
    .handleMessageFromWidget(ev.data)
    .catch((e: unknown) => log("err", String(e)))
    .finally(refresh);
});

await init();
$("exampleNew").onclick = () => ($<HTMLTextAreaElement>("event").value = JSON.stringify(EXAMPLE_NEW, null, 2));
$("exampleLegacy").onclick = () => ($<HTMLTextAreaElement>("event").value = JSON.stringify(EXAMPLE_LEGACY, null, 2));
$("load").onclick = () => {
  try {
    loadWidget();
  } catch (e) {
    log("err", String(e));
  }
};
$("injectBtn").onclick = () => {
  try {
    log("info", `injected, forwarded: ${host?.injectEvent(JSON.parse(value("inject")))}`);
  } catch (e) {
    log("err", String(e));
  }
  refresh();
};
$("pushState").onclick = () => (log("info", `update_state sent with ${host?.pushState()} events`), refresh());
$("clear").onclick = () => (host?.clearStore(), refresh());
$("fail").onchange = () => host?.failSends(checked("fail") ? "simulated failure (fail sends is on)" : undefined);
$("clearLog").onclick = () => $("log").replaceChildren();

// Prefill from the URL so e2e tests can start deterministically:
//   ?event=<json state event>&autoApprove=1&autoload=1&wrapper=<url>
const params = new URLSearchParams(location.search);
$<HTMLTextAreaElement>("event").value = params.get("event") ?? JSON.stringify(EXAMPLE_NEW, null, 2);
$<HTMLTextAreaElement>("inject").value = JSON.stringify(EXAMPLE_EVENT, null, 2);
if (params.get("wrapper")) $<HTMLInputElement>("wrapper").value = params.get("wrapper")!;
$<HTMLInputElement>("autoApprove").checked = params.get("autoApprove") === "1";
if (params.get("autoload") === "1") $("load").click();
