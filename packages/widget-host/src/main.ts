import {
  InMemoryBackend,
  WidgetHostDriver,
  matrixEventFromJson,
  uniffiInitAsync,
  type WidgetHostPlatform,
} from "@matrix-widget-tools/widget-host-bindings";

import { resolveWidget, type StateEvent } from "./widgets";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const value = (id: string) => $<HTMLInputElement>(id).value;
const checked = (id: string) => $<HTMLInputElement>(id).checked;
// `originServerTs` and friends are `bigint` in the bindings; JSON.stringify refuses those.
const stringify = (data: unknown, indent?: number) =>
  JSON.stringify(data, (_, v: unknown) => (typeof v === "bigint" ? Number(v) : v), indent);
const show = (id: string, data: unknown) => ($(id).textContent = stringify(data, 2));
const pretty = (data: unknown) => (typeof data === "string" ? data : stringify(data));
const el = (tag: string, className: string, text: string) =>
  Object.assign(document.createElement(tag), { className, textContent: text });

/** The parts of a widget API envelope the log highlights, if `data` is one. */
function envelope(data: unknown) {
  if (typeof data !== "object" || data === null) return undefined;
  const msg = data as Record<string, unknown>;
  if (typeof msg.action !== "string" || typeof msg.requestId !== "string") return undefined;
  const direction = "response" in msg ? "response" : "request";
  return { action: msg.action, direction, requestId: msg.requestId, body: msg[direction] };
}

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

const EXAMPLE_TO_DEVICE = {
  type: "org.example.ping",
  sender: "@bob:example.org",
  content: { n: 1 },
  encrypted: false,
};

/** Capabilities the compat wrapper needs to template a legacy widget's URL. */
const CONTEXT_CAPABILITIES = ["org.matrix.msc4412.matrix_context", "org.matrix.msc4412.client_context"];

let driver: WidgetHostDriver | undefined;
let backend: InMemoryBackend | undefined;
let iframe: HTMLIFrameElement | undefined;
let widgetOrigin = "*";

const LABELS = { in: "← widget", out: "→ widget", err: "error", info: "info" };

/** One log line: time and direction, then for envelopes the action, `(request|response <id>)` and the body. */
function log(kind: keyof typeof LABELS, data: unknown) {
  const line = el("pre", kind, `${new Date().toISOString().slice(11, 23)} ${LABELS[kind]} `);
  const msg = envelope(data);
  if (msg) {
    line.append(
      el("span", "action", msg.action),
      "\n",
      el("span", msg.direction, `(${msg.direction} ${msg.requestId})`),
      "\n",
      stringify(msg.body, 2),
    );
  } else {
    line.append(pretty(data));
  }
  $("log").prepend(line);
}

function refresh() {
  if (!driver || !backend) return;
  show("snapshot", driver.snapshot());
  show("timeline", backend.timeline());
  show("delayed", backend.delayedEvents());
  show("toDeviceSent", backend.toDeviceSent());
  show("state", backend.state());
}

function askCapabilities(requested: string[]) {
  if (checked("autoApprove")) return driver?.approveCapabilities(requested);
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
    driver?.approveCapabilities(inputs.filter((i) => i.checked).map((i) => i.value));
    box.replaceChildren();
    refresh();
  };
  box.append(approve);
}

/** What the driver needs from this page. The driver calls these synchronously from inside its own methods. */
const platform: WidgetHostPlatform = {
  sendToWidget(json) {
    const message = JSON.parse(json);
    log("out", message);
    iframe?.contentWindow?.postMessage(message, widgetOrigin);
  },
  onCapabilitiesRequested(requested) {
    // Decide outside the driver call that reported the request, then call back in.
    queueMicrotask(() => (askCapabilities(requested), refresh()));
  },
  onContentLoaded() {
    $("spinner").hidden = true;
    if (iframe) iframe.hidden = false;
  },
  clientId: () => "widget-test-host",
  clientTheme: () => "light",
  clientLanguage: () => "en",
};

function loadWidget() {
  const widget = resolveWidget(JSON.parse(value("event")) as StateEvent, value("wrapper"));
  $("decision").textContent = `${widget.legacy ? "legacy event → compat wrapper" : "MSC4411 event → direct"}\n${widget.url}`;

  iframe?.remove();
  $("caps").replaceChildren();
  // A fresh in-memory room per load, handed to the driver like any other MatrixBackend would be
  // (a matrix-js-sdk backed one, say).
  backend = new InMemoryBackend(value("room"), value("user"));
  driver = new WidgetHostDriver(backend.asBackend(), platform);
  // A legacy client handed these facts over as URL template parameters; the compat wrapper
  // asks for them instead, so grant them without a prompt. The driver applies the rule.
  if (widget.legacy) driver.setAutoApproved(CONTEXT_CAPABILITIES);
  widgetOrigin = new URL(widget.url).origin;
  iframe = Object.assign(document.createElement("iframe"), { src: widget.url, hidden: widget.usesWidgetApi });
  $("spinner").hidden = !widget.usesWidgetApi;
  $("frame").querySelector(".fill")!.append(iframe);
  refresh();
}

window.addEventListener("message", (ev) => {
  if (!driver || !iframe || ev.source !== iframe.contentWindow) return;
  log("in", ev.data);
  driver
    .handleMessageFromWidget(typeof ev.data === "string" ? ev.data : JSON.stringify(ev.data))
    .catch((e: unknown) => log("err", String(e)))
    .finally(refresh);
});

await uniffiInitAsync();
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
    const event = backend?.inject(matrixEventFromJson(value("inject")));
    log("info", `stored ${event?.eventId}; the widget gets it if its capabilities allow`);
  } catch (e) {
    log("err", String(e));
  }
  refresh();
};
$("injectToDeviceBtn").onclick = () => {
  try {
    const m = JSON.parse(value("injectToDevice")) as { type: string; sender: string; content: unknown; encrypted?: boolean };
    backend?.injectToDevice({ eventType: m.type, sender: m.sender, content: m.content, encrypted: m.encrypted === true });
    log("info", "delivered to the to-device subscription; the widget gets it if its capabilities allow");
  } catch (e) {
    log("err", String(e));
  }
  refresh();
};
$("clear").onclick = () => (backend?.clear(), refresh());
$("fireDelayed").onclick = () => {
  const next = backend?.delayedEvents()[0];
  if (!next) return log("info", "no delayed event scheduled");
  try {
    const event = backend?.fireDelayedEvent(next.delayId);
    log("info", `fired ${next.delayId} as ${event?.eventId}`);
  } catch (e) {
    log("err", String(e));
  }
  refresh();
};
$("fail").onchange = () => backend?.failSends(checked("fail") ? "simulated failure (fail sends is on)" : undefined);
$("clearLog").onclick = () => $("log").replaceChildren();

// Prefill from the URL so e2e tests can start deterministically:
//   ?event=<json state event>&autoApprove=1&autoload=1&wrapper=<url>
const params = new URLSearchParams(location.search);
$<HTMLTextAreaElement>("event").value = params.get("event") ?? JSON.stringify(EXAMPLE_NEW, null, 2);
$<HTMLTextAreaElement>("inject").value = JSON.stringify(EXAMPLE_EVENT, null, 2);
$<HTMLTextAreaElement>("injectToDevice").value = JSON.stringify(EXAMPLE_TO_DEVICE, null, 2);
if (params.get("wrapper")) $<HTMLInputElement>("wrapper").value = params.get("wrapper")!;
$<HTMLInputElement>("autoApprove").checked = params.get("autoApprove") === "1";
if (params.get("autoload") === "1") $("load").click();
