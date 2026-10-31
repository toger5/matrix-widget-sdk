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
// File contents (`base64`) are cut short so an image does not flood the log.
const stringify = (data: unknown, indent?: number) =>
  JSON.stringify(
    data,
    (key, v: unknown) =>
      typeof v === "bigint" ? Number(v) : key === "base64" && typeof v === "string" && v.length > 80 ? `${v.slice(0, 80)}… (${v.length} chars)` : v,
    indent,
  );
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

/**
 * Demo files every fresh in-memory store starts with (served from `public/demo/`), so a widget
 * has something to `download_file`. The first one is the test widgets' default URI.
 */
const DEMO_MEDIA = [
  { contentUri: "mxc://example.org/demo-landscape", path: "demo/landscape.png", mimetype: "image/png" },
  { contentUri: "mxc://example.org/demo-tiles", path: "demo/tiles.png", mimetype: "image/png" },
  { contentUri: "mxc://example.org/demo-notes", path: "demo/notes.txt", mimetype: "text/plain" },
];

async function seedMedia(target: InMemoryBackend) {
  for (const { contentUri, path, mimetype } of DEMO_MEDIA) {
    const data = await (await fetch(path)).arrayBuffer();
    target.addMedia(contentUri, { data, mimetype });
  }
}

/** Object URLs of the files shown in the media list, by `mxc://` URI; reset with the store. */
const mediaUrls = new Map<string, string>();

/** The media repository: images are previewed, everything else can be saved. */
function showMedia() {
  const files = backend?.media() ?? [];
  const list = $("media");
  const key = files.map((m) => m.contentUri).join("\n");
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  list.replaceChildren(
    ...files.map(({ contentUri, file }) => {
      let url = mediaUrls.get(contentUri);
      if (!url) {
        url = URL.createObjectURL(new Blob([file.data], { type: file.mimetype ?? "" }));
        mediaUrls.set(contentUri, url);
      }
      const name = contentUri.split("/").pop() ?? "file";
      const item = el("div", "file", "");
      const copy = Object.assign(document.createElement("button"), { textContent: "copy uri" });
      copy.onclick = () => navigator.clipboard.writeText(contentUri);
      const save = Object.assign(document.createElement("a"), { href: url, download: name, textContent: "download" });
      item.append(el("code", "", contentUri), el("div", "meta", `${file.mimetype ?? "unknown type"} · ${file.data.byteLength} bytes `), copy, save);
      if (file.mimetype?.startsWith("image/")) {
        item.append(Object.assign(document.createElement("img"), { src: url, alt: name }));
      }
      return item;
    }),
  );
}

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
  showMedia();
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

function askOpenId() {
  const box = $("openid");
  box.replaceChildren("Widget asks for an OpenID token (proves your identity to the widget's backend):");
  for (const [label, allowed] of [["Allow", true], ["Block", false]] as const) {
    const b = Object.assign(document.createElement("button"), { textContent: label });
    b.onclick = () => {
      box.replaceChildren();
      driver?.resolveOpenid(allowed).catch((e: unknown) => log("err", String(e))).finally(refresh);
    };
    box.append(b);
  }
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
  onOpenidRequested() {
    queueMicrotask(() => (askOpenId(), refresh()));
  },
  navigate(uri) {
    log("info", `widget asks to navigate to ${uri} (a real client would open it)`);
  },
  setAlwaysOnScreen(value) {
    log("info", `widget asks always-on-screen = ${value}; honoured`);
    return true;
  },
  clientId: () => "widget-test-host",
  clientTheme: () => "light",
  clientLanguage: () => "en",
};

async function loadWidget() {
  const widget = resolveWidget(JSON.parse(value("event")) as StateEvent, value("wrapper"));
  $("decision").textContent = `${widget.legacy ? "legacy event → compat wrapper" : "MSC4411 event → direct"}\n${widget.url}`;

  iframe?.remove();
  $("caps").replaceChildren();
  $("openid").replaceChildren();
  // A fresh in-memory room per load, handed to the driver like any other MatrixBackend would be
  // (a matrix-js-sdk backed one, say).
  backend = new InMemoryBackend(value("room"), value("user"));
  for (const url of mediaUrls.values()) URL.revokeObjectURL(url);
  mediaUrls.clear();
  await seedMedia(backend);
  driver = new WidgetHostDriver(backend.asBackend(), platform);
  // A legacy client handed these facts over as URL template parameters; the compat wrapper
  // asks for them instead, so grant them without a prompt. The driver applies the rule.
  if (widget.legacy) driver.setAutoApproved(CONTEXT_CAPABILITIES);
  driver.setOpenidAutoApproved(checked("autoApproveOpenId"));
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
$("load").onclick = () => loadWidget().catch((e: unknown) => log("err", String(e)));
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
let visible = true;
$("themeChange").onclick = () => driver?.notifyThemeChange({ name: "dark", is_dark: true });
$("languageChange").onclick = () => driver?.notifyLanguageChange("de");
$("visibility").onclick = () => ((visible = !visible), driver?.notifyVisibility(visible));
let turnCounter = 0;
$("pushTurn").onclick = () => {
  turnCounter += 1;
  backend?.setTurnServer({ uris: ["turn:turn.example.org:3478?transport=udp"], username: `user${turnCounter}`, password: "secret" });
  log("info", `TURN credentials #${turnCounter} pushed; watching widgets receive update_turn_servers`);
};
$("setAccountData").onclick = () => {
  backend?.setRoomAccountData("m.tag", { tags: { "u.widgets": { order: 0.5 } } });
  log("info", "room account data m.tag set");
};
$("setTransports").onclick = () => {
  backend?.setRtcTransports([{ type: "livekit", livekit_service_url: "https://livekit.example.org" }]);
  log("info", "rtc transports set");
};
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
$("autoApproveOpenId").onchange = () => driver?.setOpenidAutoApproved(checked("autoApproveOpenId"));

// Prefill from the URL so e2e tests can start deterministically:
//   ?event=<json state event>&autoApprove=1&autoload=1&wrapper=<url>
const params = new URLSearchParams(location.search);
$<HTMLTextAreaElement>("event").value = params.get("event") ?? JSON.stringify(EXAMPLE_NEW, null, 2);
$<HTMLTextAreaElement>("inject").value = JSON.stringify(EXAMPLE_EVENT, null, 2);
$<HTMLTextAreaElement>("injectToDevice").value = JSON.stringify(EXAMPLE_TO_DEVICE, null, 2);
if (params.get("wrapper")) $<HTMLInputElement>("wrapper").value = params.get("wrapper")!;
$<HTMLInputElement>("autoApprove").checked = params.get("autoApprove") === "1";
if (params.get("autoload") === "1") $("load").click();
