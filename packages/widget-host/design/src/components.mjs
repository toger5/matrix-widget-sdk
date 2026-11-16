// The mockup components. Each function returns the HTML of one view of appDesign.md, so a leaf
// (or a complete screen) is a composition of these, like the real app will be a composition of
// React components driven by the AppViewModel (src/appViewModel.ts).

import { ACCOUNTS, MEMBERS, ROOMS, SAS_EMOJI, WIDGETS, avatar, esc, icon, logo } from "./lib.mjs";

// ---------------------------------------------------------------------------------------------
// Atoms

export const ibtn = (ico, title, cls = "", size = 16) =>
  `<button class="ibtn ${cls}" title="${esc(title)}" aria-label="${esc(title)}">${icon(ico, size)}</button>`;

export const btn = (label, o = {}) =>
  `<button class="btn ${o.kind ?? ""} ${o.sm ? "sm" : ""} ${o.block ? "block" : ""}"${o.title ? ` title="${esc(o.title)}"` : ""}>${o.ico ? icon(o.ico, 14) : ""}<span>${label}</span>${o.end ? icon(o.end, 14, "end") : ""}</button>`;

export const toggle = (on, label) =>
  `<button class="toggle ${on ? "on" : ""}" role="switch" aria-checked="${on}" aria-label="${esc(label)}"><i></i></button>`;

const field = (label, value, o = {}) =>
  `<label class="field ${o.cls ?? ""}"><span class="field-l">${label}</span><span class="input ${o.mono ? "mono" : ""} ${o.select ? "select" : ""}">${value}${o.select ? icon("chevDown", 14) : ""}</span></label>`;

/** Pretty-printed, lightly highlighted JSON. */
const json = (value) =>
  esc(JSON.stringify(value, null, 2)).replace(/(&quot;[^&]*?&quot;)(:)?/g, (_, s, colon) =>
    colon ? `<span class="jk">${s}</span>:` : `<span class="js">${s}</span>`,
  );

const wico = (key, size = 18) => avatar({ name: WIDGETS[key].name, label: WIDGETS[key].label, hue: WIDGETS[key].hue, size, square: true });
const roomAv = (key, size = 22) => avatar({ name: ROOMS[key].name, hue: ROOMS[key].hue, size, square: true });
const userAv = (key, size = 28) => avatar({ name: ACCOUNTS[key].name, hue: ACCOUNTS[key].hue, size });

// ---------------------------------------------------------------------------------------------
// Fake widgets. They deliberately do not use the host's tokens: a widget is foreign content.

export function widget(kind, { compact = false } = {}) {
  const c = compact ? "compact" : "";
  switch (kind) {
    case "call": {
      const people = [["Mira", 215], ["Jonas", 28], ["Ada", 265], ["Sam", 330]];
      return `<div class="w w-call ${c}"><div class="w-grid">${people
        .map(([n, h]) => `<div class="w-tile" style="--h:${h}"><span class="w-face">${n[0]}</span><span class="w-name">${n}</span></div>`)
        .join("")}</div><div class="w-bar"><span class="w-rb">${icon("mic", 16)}</span><span class="w-rb">${icon("video", 16)}</span><span class="w-rb">${icon("monitor", 16)}</span><span class="w-rb red">${icon("phone", 16)}</span></div></div>`;
    }
    case "board":
      return `<div class="w w-board ${c}"><svg viewBox="0 0 800 500" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs><pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#d6d2c8"/></pattern></defs>
        <rect width="800" height="500" fill="#fbfaf6"/><rect width="800" height="500" fill="url(#dots)"/>
        <rect x="120" y="90" width="150" height="110" rx="6" fill="#ffe07a"/><path d="M138 120h100M138 142h80M138 164h110" stroke="#7a6410" stroke-width="5" stroke-linecap="round"/>
        <rect x="330" y="60" width="150" height="110" rx="6" fill="#ffb3c7"/><path d="M348 90h105M348 112h70" stroke="#8a2745" stroke-width="5" stroke-linecap="round"/>
        <rect x="540" y="150" width="150" height="110" rx="6" fill="#a9d8ff"/><path d="M558 180h95M558 202h110M558 224h60" stroke="#1d4e7a" stroke-width="5" stroke-linecap="round"/>
        <path d="M270 150c30-10 40-30 60-40M480 120c30 10 40 40 60 60" fill="none" stroke="#333" stroke-width="3" stroke-linecap="round"/>
        <ellipse cx="300" cy="360" rx="130" ry="70" fill="none" stroke="#e5484d" stroke-width="4"/><path d="M230 350h140M250 378h100" stroke="#333" stroke-width="5" stroke-linecap="round"/>
        <path d="M500 330l60 70 90-120" fill="none" stroke="#2f9e44" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <div class="w-tools"><i></i><i></i><i class="on"></i><i></i><i></i></div></div>`;
    case "poll":
      return `<div class="w w-poll ${c}"><div class="w-poll-in"><b>Where do we hold the offsite?</b>${[["Lisbon", 62], ["Ghent", 24], ["Remote, again", 14]]
        .map(([l, p]) => `<div class="w-opt"><span>${l}</span><span>${p}%</span><i style="width:${p}%"></i></div>`)
        .join("")}<small>21 votes · closes Friday</small></div></div>`;
    case "notes":
      return `<div class="w w-notes ${c}"><div class="w-notes-in"><b>Design crit, 14 Nov</b>${[90, 72, 84, 40, 0, 66, 88, 58]
        .map((p) => (p ? `<i style="width:${p}%"></i>` : "<u></u>"))
        .join("")}</div></div>`;
    case "timer":
      return `<div class="w w-timer ${c}"><div><b>12:47</b><small>Break ends at 14:30</small></div></div>`;
    default:
      throw new Error(`unknown widget: ${kind}`);
  }
}

// ---------------------------------------------------------------------------------------------
// LeftBar

/** The account icon while the DevBackend is active: the DevBackend icon. */
const devAv = (size) => `<span class="av dev-av" style="--s:${size}px" aria-hidden="true">${icon("cone", Math.round(size * 0.55))}</span>`;

/** tooltip: draw the tooltip of the active DevBackend button (the hover state). */
export function leftBar({ devTools = false, devBackend = false, active = null, tooltip = false } = {}) {
  const b = (ico, title, key, cls = "") =>
    `<button class="lb-btn ${active === key ? "on" : ""} ${cls}" title="${esc(title)}" aria-label="${esc(title)}"${active === key ? ' aria-pressed="true"' : ""}${cls === "placeholder" ? ' aria-disabled="true"' : ""}>${icon(ico, 18)}</button>`;
  // Pressing the DevBackend button again leaves the DevBackend.
  const devBtn = `<span class="lb-wrap">${b("cone", devBackend ? "Leave DevBackend" : "Activate the DevBackend", "devbackend", devBackend ? "dev-on" : "")}${tooltip ? '<span class="tooltip" role="tooltip">Leave DevBackend</span>' : ""}</span>`;
  return `<nav class="leftbar" aria-label="App">
    <button class="lb-logo" title="About this app" aria-label="About this app">${logo()}</button>
    ${b("plus", "New room panel (Alt+N) · with the same room: Alt+Shift+N", "new")}
    ${b("list", "Room list (coming soon: use a new panel)", "rooms", "placeholder")}
    ${devTools ? devBtn : ""}
    ${devBackend ? `<span class="lb-badge" title="Widgets only see the DevBackend">DevBackend</span>` : ""}
    <span class="sp"></span>
    ${b("settings", "Settings", "settings")}
    <button class="lb-avatar ${active === "account" ? "on" : ""}" title="Account" aria-label="Account${devBackend ? ": DevBackend" : ""}">${devBackend ? devAv(26) : userAv("ada", 26)}</button>
    ${b("panelLeft", "Collapse the bar", "collapse")}
  </nav>`;
}

// ---------------------------------------------------------------------------------------------
// SidePanel views

const sideBox = (head, body, cls = "", attrs = "") => `<section class="sidebox ${cls}"${attrs}><header class="side-head">${head}</header><div class="side-body">${body}</div></section>`;
const sideTitle = (title, sub = "") => `<div class="side-title"><b>${title}</b>${sub ? `<small>${sub}</small>` : ""}</div><span class="sp"></span>${ibtn("x", "Close panel")}`;

const menuRow = (ico, label, o = {}) =>
  `<button class="menu-row ${o.cls ?? ""}">${icon(ico, 16)}<span>${label}</span>${o.end ? icon(o.end, 14, "end") : ""}</button>`;

const switchRow = (key) => {
  const a = ACCOUNTS[key];
  return `<button class="switch-acc">${userAv(key, 30)}<span class="switch-txt"><small>switch to</small><b>${a.name}</b><em>${a.id}</em></span>${icon("arrowRight", 16, "end")}</button>`;
};

const addAccountRow = () =>
  `<button class="switch-acc add"><span class="av ghost" style="--s:30px" aria-hidden="true">${icon("userPlus", 14)}</span><span class="switch-txt"><b>Add account</b></span>${icon("external", 14, "end")}</button>`;

const VERIFY_RUNNING = ["waiting", "emoji", "confirming", "recovery-key", "recovery-checking", "recovery-wrong"];

/**
 * The "Verify this device" box of the AccountView. state: "start" | "failed" (the box again, with
 * the reason) | "waiting" | "emoji" | "confirming" (another device) | "recovery-key" |
 * "recovery-checking" | "recovery-wrong" | "done". Every running step has the cancel button.
 */
function verifyBox(state) {
  const head = (ico, title) =>
    `<div class="verify-h">${icon(ico, 16)}<h3 id="verify-h">${title}</h3>${VERIFY_RUNNING.includes(state) ? ibtn("x", "Cancel verification") : ""}</div>`;
  const box = (body, cls = "") => `<section class="verify ${cls}" aria-labelledby="verify-h">${body}</section>`;
  const spinner = `<span class="spinner" aria-hidden="true"></span>`;
  const status = (text) => `<div class="verify-status" role="status">${spinner}<span>${text}</span></div>`;
  const error = (text, detail = "") => `<div class="verify-err" role="alert">${icon("alert", 14)}<span>${text}${detail ? `<small>${detail}</small>` : ""}</span></div>`;
  const emoji = (dim) =>
    `<ol class="verify-emoji ${dim ? "dim" : ""}" aria-label="Emoji to compare">${SAS_EMOJI.map(([e, name]) => `<li><span aria-hidden="true">${e}</span>${name}</li>`).join("")}</ol>`;
  const keyField = (cls = "") =>
    `<label class="field"><span class="field-l">Recovery key</span><span class="input mono ${cls}"${cls === "invalid" ? ' aria-invalid="true"' : ""}>EsTc LW2K PGiF wKEA 3As5 g5c4 BXwk qeeJ ZJV8 Q9fu gUMN UE4d</span></label>`;

  if (state === "start" || state === "failed")
    return box(`${head("alert", "Verify this device")}
      ${state === "failed" ? error("The emoji did not match, so this device was not verified.") : `<p class="hint">Your other devices share the keys of encrypted rooms only with verified devices. Until then, widgets cannot read encrypted messages.</p>`}
      ${btn("Verify with another device", { kind: "primary", ico: "monitor", block: true })}${btn("Use recovery key", { ico: "key", block: true })}`);
  if (state === "waiting")
    return box(`${head("monitor", "Verify with another device")}${status("Waiting for another device…")}
      <p class="hint">Accept the request in another app where you are logged in as ${ACCOUNTS.ada.id}, and choose to compare emoji.</p>`);
  if (state === "emoji" || state === "confirming")
    return box(`${head("monitor", "Compare emoji")}<p class="hint">Does the other device show the same emoji, in the same order?</p>${emoji(state === "confirming")}
      ${state === "emoji" ? `<div class="verify-actions">${btn("They don't match")}${btn("They match", { kind: "primary" })}</div>` : status("Waiting for the other device to confirm…")}`);
  if (state.startsWith("recovery-"))
    return box(`${head("key", "Use recovery key")}
      <p class="hint">The key you saved when encryption was set up for this account: 12 groups of four characters.</p>
      ${keyField(state === "recovery-checking" ? "disabled" : state === "recovery-wrong" ? "invalid" : "")}
      ${state === "recovery-wrong" ? error("This recovery key was not accepted.", "The key does not open the secret storage of this account.") : ""}
      ${state === "recovery-checking" ? `<button class="btn primary block" disabled>${spinner}<span>Checking…</span></button>` : btn("Verify", { kind: "primary", block: true })}`);
  return box(`${head("shield", "This device is verified")}
    <p class="hint">Your other devices share the keys of encrypted rooms with it now. Older messages may take a moment to decrypt.</p>${btn("Done", { block: true })}`, "ok");
}

/**
 * mode: "one" | "several" | "dev". verify: a state of `verifyBox` (not set: this device is
 * verified). While a step runs, the box replaces the device details and the menu.
 */
export function accountView({ mode = "one", verify } = {}) {
  if (mode === "dev") {
    const body = `<div class="acc-card dev">${devAv(44)}<div><b>DevBackend</b><small>@alice:dev.local</small><span class="pill dev">in-memory · no Matrix requests</span></div></div>
      <p class="hint">The DevBackend is its own account. Switch to one of your Matrix accounts to leave it. The mocked rooms are kept.</p>
      <h4 class="side-h">Accounts</h4>
      <div class="acc-list">${["ada", "work", "bot"]
        .map((k) => `<div class="acc-line">${userAv(k, 30)}<span class="switch-txt"><b>${ACCOUNTS[k].name}</b><em>${ACCOUNTS[k].id}</em></span></div>${btn(`Switch to ${ACCOUNTS[k].name}`, { end: "arrowRight", block: true })}`)
        .join("")}<div class="acc-list-end">${addAccountRow()}</div></div>`;
    return sideBox(sideTitle("Account"), body);
  }
  const a = ACCOUNTS.ada;
  const verified = !verify || verify === "done";
  const details = `<dl class="kv"><dt>Homeserver</dt><dd>${a.hs}</dd><dt>Device</dt><dd class="mono">${a.device}</dd><dt>Verified</dt><dd>${
    verified ? `<span class="ok-text">${icon("shield", 13)} This device is verified</span>` : `<span class="acc-unverified">${icon("alert", 13)} This device is not verified</span>`
  }</dd></dl>
    <div class="menu">
      ${menuRow("monitor", "Manage account &amp; devices", { end: "external" })}
      ${menuRow("copy", "Copy Matrix URI")}
      ${menuRow("logout", "Log out", { cls: "danger" })}
    </div>`;
  const body = `<div class="acc-card">${userAv("ada", 56)}<div><b>${a.name}</b><small>${a.id}</small></div></div>${verify ? `\n    ${verifyBox(verify)}` : ""}
    ${VERIFY_RUNNING.includes(verify) ? "" : details}
    <span class="sp"></span>
    <div class="switch-list">${mode === "several" ? switchRow("work") + switchRow("bot") : ""}${addAccountRow()}</div>`;
  return sideBox(sideTitle("Account"), body, "acc");
}

export function settingsView({ devTools = false } = {}) {
  const body = `<h4 class="side-h">Appearance</h4>
    <div class="set-row"><div><b>Theme</b><small>Follows the system unless you choose one.</small></div></div>
    <div class="seg" role="radiogroup" aria-label="Theme"><span class="on" role="radio" aria-checked="true">System</span><span role="radio" aria-checked="false">Light</span><span role="radio" aria-checked="false">Dark</span></div>
    <h4 class="side-h">Developer</h4>
    <div class="set-row"><div><b>Enable dev tools</b><small>Tools to inspect and mock what a widget sees.</small></div>${toggle(devTools, "Enable dev tools")}</div>
    ${
      devTools
        ? `<ul class="set-list on"><li>${icon("cone", 14)}<span><b>DevBackend</b> button in the left bar</span></li><li>${icon("dots", 14)}<span><b>Widget dev tools</b> via the ⋯ button of a widget tab</span></li><li>${icon("copy", 14)}<span><b>Copy to DevBackend</b> in the room overview</span></li></ul>`
        : `<p class="hint">While this is off, no dev tool is shown anywhere in the app.</p>`
    }`;
  return sideBox(sideTitle("Settings"), body);
}

// --- DevBackendView --------------------------------------------------------------------------

const acc = (title, open, content = "", count = "") =>
  `<div class="acc-sec ${open ? "open" : ""}"><button class="acc-sec-h" aria-expanded="${open}">${icon(open ? "chevDown" : "chevRight", 14)}<span>${title}</span>${count ? `<em>${count}</em>` : ""}</button>${open ? `<div class="acc-sec-b">${content}</div>` : ""}</div>`;

const sub = (title, tools = "") => `<div class="sub-h"><span>${title}</span>${tools}</div>`;

const delayRow = (on) =>
  `<div class="inline-row">${toggle(on, "Send delayed")}<span>Delayed</span>${on ? `<span class="input mono narrow">5000</span><span class="muted">ms</span>` : ""}<span class="sp"></span>${btn(on ? "Schedule" : "Send", { kind: "primary", sm: true, ico: on ? "clock" : "send" })}</div>`;

const stateTree = (editing) => {
  const row = (type, n, open = false) => `<div class="tree-row lvl0">${icon(open ? "chevDown" : "chevRight", 12)}<span class="mono">${type}</span><em>${n}</em></div>`;
  const key = (k, sel = false) => `<div class="tree-row lvl1 ${sel ? "sel" : ""}"><span class="mono">${k}</span>${ibtn("edit", "Edit this state event", "xs")}</div>`;
  const content = { membership: "join", displayname: "Bob" };
  return `<div class="tree">
    ${row("m.room.create", 1)}${row("m.room.name", 1)}${row("m.room.topic", 1)}
    ${row("m.room.member", 3, true)}${key("@alice:dev.local")}${key("@bob:dev.local", true)}
    ${
      editing
        ? `<div class="editor"><div class="editor-h"><span class="mono">m.room.member · @bob:dev.local</span><span class="pill">editing</span></div><pre class="code edit">${json({ membership: "leave", displayname: "Bob" })}<span class="caret"></span></pre><div class="inline-row"><span class="muted">Saving sends a new state event.</span><span class="sp"></span>${btn("Cancel", { sm: true })}${btn("Save", { kind: "primary", sm: true })}</div></div>`
        : `<pre class="code">${json(content)}</pre>`
    }
    ${key("@carol:dev.local")}
    ${row("org.matrix.msc4411.widget", 3)}${row("m.room.power_levels", 1)}
  </div>`;
};

/** The predefined forms of "send state" and "send event": chips in a tablist named `label`. */
const formChips = (forms, activeForm, label) =>
  `<div class="chips" role="tablist" aria-label="${label}">${forms.map((f) => `<span class="chip ${f === activeForm ? "on" : ""}" role="tab" aria-selected="${f === activeForm}">${f}</span>`).join("")}</div>`;

const STATE_FORMS = ["Widget", "Element Call", "Raw JSON"];
/** form: one of STATE_FORMS */
const sendStateForm = (form) => {
  const body = {
    Widget: `${field("Event type", "m.widget", { mono: true, select: true })}${field("Widget ID", "widget-2", { mono: true })}${field("Name", "New test widget")}${field("URL", "http://localhost:5175/new/", { mono: true })}<div class="inline-row">${toggle(true, "Uses the widget API")}<span>Uses the widget API</span></div>`,
    "Element Call": `${field("Element Call URL", "https://call.element.io/room", { mono: true })}${field("Intent", "start_call", { mono: true, select: true })}${field("Widget ID", "element-call", { mono: true })}<p class="hint">A legacy <span class="mono">m.call</span> widget, as Element Web describes its call. The compat wrapper fills in the user, device, room, language and theme.</p>`,
    "Raw JSON": `${field("Type", "m.room.topic", { mono: true })}${field("State key", "<span class='ph'>empty</span>", { mono: true })}<pre class="code edit">${json({ topic: "Mocked room for the call widget." })}</pre>`,
  }[form];
  return `${sub("Send state")}${formChips(STATE_FORMS, form, "State form")}<div class="form">${body}${delayRow(false)}</div>`;
};

/** form: one of STATE_FORMS; editing: the editor of one state event is open */
const stateSection = ({ form = "Widget", editing = false } = {}) =>
  `${sub("Shortcuts")}<div class="chips">${btn("Edit name", { sm: true, ico: "edit" })}${btn("Edit description", { sm: true, ico: "edit" })}${btn("Add member", { sm: true, ico: "userPlus" })}</div>
   ${sendStateForm(form)}
   ${sub("Current state", `<span class="input search sm">${icon("search", 12)}<span class="ph">Filter by type or key</span></span>`)}${stateTree(editing)}`;

const EVENT_FORMS = ["Message", "Sticker", "RTC member", "Image / audio", "Raw JSON"];

const eventList = () => {
  const rows = [
    ["m.room.message", "@bob:dev.local", "“Can you hear me?”", "12:04:33"],
    ["org.matrix.msc4143.rtc.member", "@alice:dev.local", "joined · device ALICEDEV", "12:04:31"],
    ["m.sticker", "@carol:dev.local", "party parrot", "12:03:02"],
    ["m.room.message", "@alice:dev.local", "“Starting the call now”", "12:02:47"],
    ["m.room.member", "@carol:dev.local", "joined", "12:01:10"],
  ];
  return `<div class="ev-list">${rows.map(([t, s, p, time]) => `<div class="ev"><span class="mono ev-t">${t}</span><span class="ev-time">${time}</span><span class="ev-p">${p}</span><span class="ev-s">${s}</span></div>`).join("")}</div>`;
};

/** form: "Message" | "Raw JSON"; delayed: show the delayed-event state */
const timelineSection = ({ form = "Message", delayed = false } = {}) => {
  const formBody =
    form === "Raw JSON"
      ? `<pre class="code edit tall">${json({ type: "m.room.message", sender: "@bob:dev.local", content: { msgtype: "m.text", body: "Can you hear me?" } })}<span class="caret"></span></pre>`
      : `${field("Sender", `${avatar({ name: "Bob", hue: 200, size: 16 })} @bob:dev.local`, { select: true })}${field("Body", "Can you hear me?")}`;
  const scheduled = delayed
    ? `${sub("Scheduled", "<em class='count'>2</em>")}<div class="ev-list">
        <div class="ev sched"><span class="mono ev-t">m.room.message</span><span class="ev-time">${icon("clock", 11)} in 3.2 s</span><span class="ev-p">“Can you hear me?”</span><span class="ev-acts">${btn("Send now", { sm: true })}${btn("Restart", { sm: true })}${btn("Cancel", { sm: true })}</span></div>
        <div class="ev sched"><span class="mono ev-t">org.matrix.msc4143.rtc.member</span><span class="ev-time">${icon("clock", 11)} in 7.9 s</span><span class="ev-p">leave · scheduled by Element Call</span><span class="ev-acts">${btn("Send now", { sm: true })}${btn("Restart", { sm: true })}${btn("Cancel", { sm: true })}</span></div>
      </div>`
    : "";
  return `${sub("Send event")}${formChips(EVENT_FORMS, form, "Event form")}<div class="form">${formBody}${delayRow(delayed)}</div>${scheduled}${sub("Events", "<em class='count'>5 of 128</em>")}${eventList()}`;
};

const behaviorSection = () =>
  `<div class="set-row"><div><b>Auto-approve capabilities</b><small>Grant everything a widget asks for, without the prompt.</small></div>${toggle(true, "Auto-approve capabilities")}</div>
   <div class="set-row"><div><b>Auto-approve OpenID tokens</b><small>Answer get_openid without asking.</small></div>${toggle(false, "Auto-approve OpenID tokens")}</div>
   <div class="set-row"><div><b>Remember capabilities</b><small>Off: a widget asks again every time it starts.</small></div>${toggle(false, "Remember capabilities")}</div>
   <div class="set-row"><div><b>Fail sends</b><small>Every send from a widget is answered with an error.</small></div>${toggle(false, "Fail sends")}</div>`;

const toDeviceSection = () =>
  `${sub("Send to the widget's device")}<div class="form">${field("Type", "org.matrix.msc4143.rtc.encryption_keys", { mono: true })}${field("Sender", `${avatar({ name: "Bob", hue: 200, size: 16 })} @bob:dev.local · BOBDEV`, { select: true })}<pre class="code edit">${json({ keys: [{ index: 0, key: "c2VjcmV0" }] })}</pre><div class="inline-row">${toggle(true, "Mark as encrypted")}<span>Mark as encrypted</span><span class="sp"></span>${btn("Send", { kind: "primary", sm: true, ico: "send" })}</div></div>
   ${sub("Sent by widgets", "<em class='count'>2</em>")}<div class="ev-list">
     <div class="ev"><span class="mono ev-t">org.matrix.msc4143.rtc.encryption_keys</span><span class="ev-time">12:04:32</span><span class="ev-p">to @bob:dev.local · BOBDEV</span><span class="ev-s">Element Call</span></div>
     <div class="ev"><span class="mono ev-t">org.matrix.msc4143.rtc.encryption_keys</span><span class="ev-time">12:04:32</span><span class="ev-p">to @carol:dev.local · *</span><span class="ev-s">Element Call</span></div>
   </div>`;

const roomMenu = () =>
  `<div class="dropdown" role="listbox" aria-label="Mocked rooms">
     <div class="dd-row on" role="option" aria-selected="true">${roomAv("lab", 22)}<span><b>Widget lab</b><small class="mono">!lab:dev.local</small></span>${icon("check", 14, "end")}</div>
     <div class="dd-row" role="option">${roomAv("design", 22)}<span><b>Design crit <i class="pill">copy</i></b><small class="mono">!hGtVzqNmPa:dev.local</small></span></div>
     <div class="dd-row" role="option">${roomAv("empty", 22)}<span><b>Empty room</b><small class="mono">!empty:dev.local</small></span></div>
     <div class="dd-sep"></div>
     <div class="dd-row add" role="option">${icon("plus", 16)}<span><b>Add room</b></span></div>
   </div>`;

/** The tool boxes below the room box. Each tool is a button; at most one is open as a box, in the place of its button. */
const TOOLS = {
  client: { ico: "monitor", label: "Client Backend Tool", title: "Client backend", minimise: "Minimise the client backend tool", resize: "Resize the client backend box" },
  media: { ico: "image", label: "Media Backend Tool", count: "3 files", title: "Media", minimise: "Minimise the media tool", resize: "Resize the media box" },
};

const toolButton = (tool) => {
  const t = TOOLS[tool];
  return `<button class="tool-btn" aria-expanded="false">${icon(t.ico, 16)}<span>${t.label}</span>${t.count ? `<em>${t.count}</em>` : ""}${icon("chevRight", 14, "end")}</button>`;
};

const toolSplit = (tool) =>
  `<div class="vsplit" role="separator" aria-orientation="horizontal" aria-label="${TOOLS[tool].resize}" aria-valuenow="40" aria-valuemin="15" aria-valuemax="80" tabindex="0" title="Drag or use the arrow keys to resize · double click or Enter to reset"><i></i></div>`;

const toolHead = (tool) => {
  const t = TOOLS[tool];
  return `${icon(t.ico, 16)}<div class="side-title"><b>${t.title}</b><small>shared by all mocked rooms</small></div><span class="sp"></span>${ibtn("minus", t.minimise)}`;
};

/** height: the box's height in px (dragged at the separator); default: its share of the column. */
const toolStyle = (height) => (height ? ` style="flex-basis:${height}px"` : "");

/** section: "behavior" | "todevice" | null (both closed) */
const clientBox = (section, height) =>
  sideBox(
    toolHead("client"),
    acc("Widget host behavior", section === "behavior", behaviorSection()) + acc("To-device messages", section === "todevice", toDeviceSection(), "2"),
    "devb toolbox",
    ` aria-label="Client backend"${toolStyle(height)}`,
  );

const mediaBox = (height) => {
  const rows = [
    ["image", "screenshot-call.png", "image/png · 184 kB", "uploaded here", "mxc://dev.local/a1B2c3D4"],
    ["image", "avatar-bob.jpg", "image/jpeg · 22 kB", "uploaded here", "mxc://dev.local/e5F6g7H8"],
    ["audio", "voice-message.ogg", "audio/ogg · 96 kB", "by Whiteboard", "mxc://dev.local/i9J0k1L2"],
  ];
  const body = `<div class="drop">${icon("upload", 16)}<span>Drop files or <u>browse</u> to upload</span></div>
    <div class="media-list">${rows
      .map(([ico, name, meta, by, mxc]) => `<div class="media"><span class="thumb">${icon(ico, 16)}</span><span class="media-t"><b>${name}</b><small>${meta} · <i>${by}</i></small><small class="mono">${mxc}</small></span>${ibtn("copy", "Copy the MXC URI", "xs")}</div>`)
      .join("")}</div>`;
  return sideBox(toolHead("media"), body, "toolbox mediabox", ` aria-label="Media"${toolStyle(height)}`);
};

/** tool: null (only the buttons) | "client" | "behavior" | "todevice" (the Client Backend Tool open, with that section open) | "media" */
const toolBoxes = (tool, height) => {
  const client = ["client", "behavior", "todevice"].includes(tool) ? toolSplit("client") + clientBox(tool, height) : toolButton("client");
  const media = tool === "media" ? toolSplit("media") + mediaBox(height) : toolButton("media");
  return client + media;
};

/**
 * state (the room box): "none" | "dropdown" | "state" | "state-element-call" | "state-raw" | "state-edit" | "timeline" |
 * "timeline-raw" | "timeline-delayed" | "closed" (all sections closed).
 * tool: see `toolBoxes`; toolHeight: the open tool box's height in px.
 */
const STATE_PAGES = { state: {}, "state-element-call": { form: "Element Call" }, "state-raw": { form: "Raw JSON" }, "state-edit": { editing: true } };

export function devBackendView({ state = "state", tool = null, toolHeight } = {}) {
  const leave = `<button class="leave-link" title="Back to your Matrix account. The mocked rooms are kept.">Leave DevBackend${icon("logout", 14)}</button>`;
  const tail = toolBoxes(tool, toolHeight) + leave;
  if (state === "none") {
    const head = `<div class="room-pick none"><span class="av sq ghost" style="--s:28px">${icon("hash", 14)}</span><div class="side-title"><b>No mocked room</b><small>DevBackend</small></div>${icon("chevDown", 14, "end")}</div>`;
    const body = `<div class="empty">${icon("cone", 28)}<b>No mocked rooms yet</b><p>Create an empty room, or copy a real one from its room overview (Dev tools › Copy to DevBackend).</p>${btn("Create a room", { kind: "primary", ico: "plus" })}</div>`;
    return sideBox(head, body, "devb") + tail;
  }
  const head = `<button class="room-pick ${state === "dropdown" ? "open" : ""}" aria-haspopup="listbox" aria-expanded="${state === "dropdown"}">${roomAv("lab", 28)}<div class="side-title"><b>Widget lab</b><small class="mono">!lab:dev.local</small></div>${icon("chevDown", 14, "end")}</button>${state === "dropdown" ? roomMenu() : ""}`;
  const s = state === "dropdown" ? "closed" : state;
  const body =
    acc("State", Object.hasOwn(STATE_PAGES, s), stateSection(STATE_PAGES[s]), "9 types") +
    acc("Timeline", s.startsWith("timeline"), timelineSection({ form: s === "timeline-raw" ? "Raw JSON" : "Message", delayed: s === "timeline-delayed" }), "128 events");
  return sideBox(head, body, "devb") + tail;
}

// ---------------------------------------------------------------------------------------------
// Tabs and the room panel

/**
 * A widget tab. t: { widget: key, active?, pinned?, devOpen? }
 * devTools adds the overflow (⋯) button. altW: the panel has a tab, so Alt+W closes the shown tab
 * and its × names the shortcut (else Alt+W closes the panel).
 */
export function tab(t, devTools = false, altW = true) {
  const cls = `tab widget ${t.active ? "active" : ""} ${t.pinned ? "pinned" : ""}`;
  const name = WIDGETS[t.widget].name;
  const main = `<button class="tab-main" role="tab" aria-selected="${!!t.active}" tabindex="${t.active ? 0 : -1}" title="${name}${t.pinned ? " · always on screen" : ""}">${wico(t.widget, 16)}<span class="tab-label">${name}</span>${t.pinned ? `<span class="tab-pin">${icon("pin", 13)}</span><span class="vh">, always on screen</span>` : ""}</button>`;
  // ⋯ and × are shown on the active tab; on the others they appear on hover and keyboard focus.
  const dev = devTools && (t.active || t.devOpen) ? `<button class="tab-btn ${t.devOpen ? "on" : ""}" title="Dev tools of ${name}" aria-label="Dev tools of ${name}" aria-pressed="${!!t.devOpen}">${icon("dots", 14)}</button>` : "";
  const close = t.active ? `<button class="tab-btn" title="Close ${name}${altW ? " (Alt+W)" : ""}" aria-label="Close ${name}">${icon("x", 12)}</button>` : "";
  return `<div class="${cls}">${main}${dev}${close}</div>`;
}

/**
 * The room name: the first tab of a room panel. Selected (no widget tab is shown), it looks like an
 * active tab and the body is the RoomOverview. It has no close button. Its name is the room name;
 * the counts are visible text with tooltips.
 */
export const roomTab = (room, selected) => {
  const r = ROOMS[room];
  return `<button class="room-chip ${selected ? "active" : ""}" role="tab" aria-selected="${selected}" tabindex="${selected ? 0 : -1}" aria-label="${r.name}" title="${r.name} · open the room overview">${roomAv(room, 24)}<span class="room-name">${r.name}</span><span class="room-counts"><span title="${r.widgets} widgets">${icon("grid", 12)}${r.widgets}</span><span title="${r.members} members">${icon("users", 12)}${r.members}</span></span></button>`;
};

/**
 * A room panel: header (room name tab + widget tabs) and a full-bleed body. The room name is
 * selected while no widget tab is active. The tablist wrapper is `display: contents`, so the
 * header lays out its children as one row; only the widget tabs (`.tabs`) scroll.
 * o: { room?: key, tabs?: [], body, devTools?, overflow?: bool, menu?: html,
 *      fs?: fullscreen (no "+" and no tab of a single widget, unless hover is set), hover?: bool }
 */
export function roomPanel(o) {
  const tabs = o.tabs ?? [];
  const quiet = o.fs && !o.hover;
  const showTabs = !(quiet && tabs.length <= 1);
  const roomSelected = !tabs.some((t) => t.active);
  // Alt+W closes the shown tab while the panel has a tab, else the panel.
  const altWClosesTab = tabs.length > 0;
  const widgetTabs = showTabs ? `<span class="rp-div"></span><div class="tabs ${o.overflow ? "overflowing" : ""}">${tabs.map((t) => tab(t, o.devTools, altWClosesTab)).join("")}</div>` : "";
  const tabList = o.room ? `<div class="rp-tabs" role="tablist" aria-label="Tabs of ${ROOMS[o.room].name}">${roomTab(o.room, roomSelected)}${widgetTabs}</div>` : "";
  const close = `<button class="ibtn " title="Close panel${altWClosesTab ? "" : " (Alt+W)"}" aria-label="Close panel">${icon("x", 16)}</button>`;
  // The + selects the room name, whose RoomOverview opens widgets.
  const head = o.room
    ? `${tabList}${quiet ? "" : ibtn("plus", "Open a widget", "tab-add")}${o.overflow ? ibtn("chevDown", `All ${tabs.length} tabs`, `tab-all ${o.menu ? "on" : ""}`) : ""}<span class="sp"></span>${close}`
    : `<span class="sp"></span>${close}`;
  return `<section class="roompanel ${o.cls ?? ""}" style="${o.style ?? ""}"><header class="rp-head">${head}</header><div class="rp-body">${o.body ?? ""}</div>${o.menu ?? ""}</section>`;
}

/** The menu of the "all tabs" button: the widget tabs (the room name never scrolls away). */
export const tabMenu = (tabs, style = "") =>
  `<div class="dropdown tab-menu" role="menu" style="${style}">${tabs
    .map((t) => `<div class="dd-row ${t.active ? "on" : ""}" role="menuitem">${wico(t.widget, 18)}<span><b>${WIDGETS[t.widget].name}</b></span>${t.pinned ? icon("pin", 12) : ""}${t.active ? icon("check", 14, "end") : ""}</div>`)
    .join("")}</div>`;

// --- Bodies of an empty room panel (no room chosen yet) ---

const pickerTop = (all) =>
  `<div class="picker-top"><span class="sp"></span><label class="switch-row"><span>Show all rooms</span>${toggle(all, "Show all rooms")}</label></div>`;

/**
 * The empty room panel: no title, centered tiles of the recent widgets (like the tiles of the
 * reference image). state: "ready" | "empty" | "loading" | "error"
 */
export function recentsBody({ state = "ready" } = {}) {
  const wrap = (inner) => `<div class="picker center"><div class="picker-in wide">${pickerTop(false)}${inner}</div></div>`;
  if (state === "empty")
    return wrap(`<div class="empty">${icon("clock", 28)}<b>No recent widgets yet</b><p>Widgets you open show up here, so you can get back to them in one click.</p>${btn("Show all rooms", { kind: "primary" })}</div>`);
  if (state === "loading")
    return wrap(`<div class="rtiles" role="status" aria-label="Loading your recent widgets">${'<div class="rtile skeleton"><i></i><i></i><i></i></div>'.repeat(6)}</div>`);
  if (state === "error")
    return wrap(`<div class="empty" role="alert">${icon("alert", 28, "danger")}<b>Your rooms could not be loaded</b><p>The homeserver did not answer (example.org, timeout after 30 s). Widgets that are already open keep running.</p>${btn("Try again", { kind: "primary", ico: "refresh" })}</div>`);
  const rows = [
    ["call", "design", "2 min ago"],
    ["board", "design", "1 h ago"],
    ["poll", "platform", "yesterday"],
    ["call", "rtc", "Tuesday"],
    ["notes", "family", "3 Nov"],
    ["board", "rtc", "28 Oct"],
  ];
  return wrap(`<div class="rtiles">${rows
    .map(([w, r, t]) => `<button class="rtile" title="Open ${WIDGETS[w].name} in ${ROOMS[r].name}"><span class="rtile-h">${roomAv(r, 16)}<span>${ROOMS[r].name}</span></span><span class="rtile-m">${wico(w, 36)}<b>${WIDGETS[w].name}</b></span><span class="rtile-f"><span>${t}</span><span class="btn sm">Open</span></span></button>`)
    .join("")}</div>`);
}

export function allRoomsBody() {
  const rooms = [
    ["platform", "<mark>Pla</mark>tform team"],
    ["rtc", "MatrixRTC <mark>pla</mark>yground"],
    ["family", "Holiday <mark>pla</mark>nning"],
  ];
  return `<div class="picker"><div class="picker-in">${pickerTop(true)}<span class="input search">${icon("search", 14)}<span>pla</span><span class="caret"></span><span class="sp"></span><kbd>Esc</kbd></span><div class="rows">${rooms
    .map(([r, name]) => {
      const room = ROOMS[r];
      return `<button class="row">${roomAv(r, 34)}<span class="row-main"><b>${name}</b><small class="mono">${room.id}</small></span><span class="row-meta">${icon("grid", 12)}${room.widgets} ${icon("users", 12)}${room.members}</span>${icon("chevRight", 14, "end")}</button>`;
    })
    .join("")}</div><p class="hint center">3 of 42 rooms match “pla”</p></div></div>`;
}

// --- Bodies of a room panel with a room ---

/** The widgets of the rooms that the mockups open. */
const ROOM_WIDGETS = { design: ["call", "board", "poll", "notes"], rtc: ["notes", "call", "timer"], lab: ["call", "notes", "board"], empty: [] };
/** The empty DevBackend room has only its creator. */
const ROOM_MEMBERS = { empty: [["Alice", "@alice:dev.local", 40, "Admin"]] };

/**
 * One widget of the RoomOverview's list. where: "here" | "other" (it has a tab in this room panel
 * or in another one) | undefined. An open widget is grayed out and offers "jump to tab"; from
 * another panel also "move widget here". The names are the ones of the tests.
 */
const overviewWidget = (k, where) => {
  const w = WIDGETS[k];
  if (!where) return `<button class="row sm" aria-label="Open ${w.name}" title="Open ${w.name} in a new tab">${wico(k, 26)}<span class="row-main"><b>${w.name}</b><small>${w.host}</small></span>${icon("arrowUpRight", 14, "end")}</button>`;
  const move = where === "other" ? `<button class="btn sm" title="Closes its tab in the other room panel and opens it here. The widget keeps running." aria-label="Move ${w.name} here">${icon("arrowLeft", 14)}<span>Move widget here</span></button>` : "";
  return `<div class="row sm opened">${wico(k, 26)}<span class="row-main"><b>${w.name}</b><small>${where === "other" ? "open in the other panel" : "open in this panel"}</small></span><span class="row-acts"><button class="btn sm primary" aria-label="Jump to the tab of ${w.name}">${icon("goToTab", 14)}<span>Jump to tab</span></button>${move}</span></div>`;
};

/**
 * The RoomOverview: what the room name tab shows, and where a room opens. The widget list comes
 * first, then encryption, members and (dev tools enabled) the dev card.
 * opened: { widgetKey: "here" | "other" }, see `overviewWidget`.
 */
export function overviewBody({ room = "design", devTools = false, opened = {} } = {}) {
  const r = ROOMS[room];
  const widgets = ROOM_WIDGETS[room] ?? ROOM_WIDGETS.design;
  const members = ROOM_MEMBERS[room] ?? MEMBERS;
  return `<div class="ov"><div class="ov-in">
    <header class="ov-hero">${roomAv(room, 72)}<div><h1>${r.name}</h1><span class="mono muted">${r.id}</span>${r.topic ? `<p>${r.topic}</p>` : ""}</div></header>
    <div class="ov-grid">
      <section class="card span"><h3>${icon("grid", 15)}Widgets <em>${widgets.length}</em></h3><div class="ov-widgets">${widgets.map((k) => overviewWidget(k, opened[k])).join("") || `<p class="muted">This room has no widgets.</p>`}</div></section>
      <section class="card span"><h3>${icon("shield", 15)}Encryption</h3><p class="ok-text"><b>End-to-end encrypted</b></p><p class="muted">Messages and widget events in this room are encrypted. This device is verified.</p></section>
      <section class="card span"><h3>${icon("users", 15)}Members <em>${r.members}</em></h3><div class="ov-members">${members.map(([n, id, h, role]) => `<div class="member">${avatar({ name: n, hue: h, size: 30 })}<span class="row-main"><b>${n}</b><small>${id}</small></span>${role ? `<span class="pill">${role}</span>` : ""}</div>`).join("")}</div>${r.members > members.length ? `<button class="link">Show all ${r.members} members</button>` : ""}</section>
      ${
        devTools
          ? `<section class="card span devcard"><h3>${icon("cone", 15)}Dev tools</h3><div class="inline-row"><div><b>Copy to DevBackend</b><p class="muted">Copies the room state and the last events into a mocked room, to experiment with it offline.</p></div><span class="sp"></span><label class="field inline"><span class="field-l">Last events</span><span class="input mono narrow">50</span></label>${btn("Copy to DevBackend", { ico: "copy", kind: "dev" })}</div></section>`
          : ""
      }
    </div></div></div>`;
}

// ---------------------------------------------------------------------------------------------
// WidgetView and the WidgetDevToolBar

const DT = { messages: ["message", "Messages"], stats: ["chart", "Stats"], driver: ["cpu", "Driver"], console: ["terminal", "Console"] };
const P = "org.matrix.mscXXXX.";

const MSGS = [
  ["from", "get_matrix_context", "ok", "12:04:31.102", "2 ms"],
  ["from", "get_client_context", "ok", "12:04:31.118", "1 ms"],
  ["from", "notify_ready", "ok", "12:04:31.140", "1 ms"],
  ["to", "update_theme", "ok", "12:04:31.300", "4 ms"],
  ["from", "read_events", "ok", "12:04:31.512", "9 ms", true],
  ["to", "forward_event", "ok", "12:04:32.040", "3 ms"],
  ["from", "send_event", "ok", "12:04:33.871", "31 ms"],
  ["to", "forward_event", "ok", "12:04:34.002", "2 ms"],
  ["from", "get_openid", "pending", "12:04:36.450", "…"],
  ["from", "send_to_device", "err", "12:04:38.090", "1 ms"],
  ["from", "set_always_on_screen", "ok", "12:04:40.007", "2 ms"],
];
const STATUS = { ok: ["check", "responded"], pending: ["clock", "waiting for a response"], err: ["alert", "error response"] };

function messagesPanel(expanded) {
  const rows = MSGS.map(([dir, action, st, time, dur, canOpen]) => {
    const open = expanded && canOpen;
    const dirHtml = dir === "from" ? `<span class="msg-dir from" role="img" aria-label="from widget to host" title="widget → host">W→H</span>` : `<span class="msg-dir to" role="img" aria-label="from host to widget" title="host → widget">H→W</span>`;
    const head = `<button class="msg-h" aria-expanded="${!!open}">${icon(open ? "chevDown" : "chevRight", 11)}${dirHtml}<span class="msg-a"><i>${P}</i>${action}</span><span class="msg-st ${st}" role="img" aria-label="${STATUS[st][1]}" title="${STATUS[st][1]}">${icon(STATUS[st][0], 12)}</span><span class="msg-time">${time}</span></button>`;
    if (!open) return `<div class="msg">${head}</div>`;
    return `<div class="msg open">${head}<div class="msg-b"><div class="msg-meta"><span>request id <b>w-0005</b></span><span>responded after <b>${dur}</b></span><span>${ibtn("copy", "Copy as JSON", "xs")}</span></div><div class="msg-cols"><div><h6>Request · widget → host</h6><pre class="code">${json({ action: `${P}read_events`, data: { type: "m.room.message", limit: 20 } })}</pre></div><div><h6>Response</h6><pre class="code">${json({ events: [{ type: "m.room.message", sender: "@bob:dev.local", content: { body: "Can you hear me?" } }], more: "19 more" })}</pre></div></div></div></div>`;
  }).join("");
  return `<div class="dt-tools"><span class="input search sm">${icon("search", 11)}<span class="ph">Filter by action</span></span><button class="chip sm on" aria-pressed="true">W→H from widget</button><button class="chip sm on" aria-pressed="true">H→W to widget</button><span class="sp"></span><span class="muted">42 of 500 max</span>${btn("Clear", { sm: true })}</div><div class="msgs">${rows}</div>`;
}

// The stats graph. The app (src/views/widget/chart.ts) uses the same numbers: a bar slot of at least 14px, a
// number of 10px text estimated at 6px per character, 3px padding, 12px line height. Bucket 57 is a spike whose
// number goes inside the bar.
const STATS_TO = Array.from({ length: 60 }, (_, i) => (i === 57 ? 3600 : i % 11 === 4 || i % 13 === 7 ? 0 : 140 + ((i * 397) % 1500)));
const STATS_FROM = Array.from({ length: 60 }, (_, i) => (i % 11 === 4 ? 0 : 60 + ((i * 211) % 620)));
// [key, color, label, total, spoken (in the name of the figure)]
const SERIES = [
  ["total", "s0", "total", "48,213", "both directions"],
  ["toWidget", "s1", "to widget", "31,870", "to the widget"],
  ["fromWidget", "s2", "from widget", "16,343", "from the widget"],
];
/** `970`, `4.4k`, `12k`, `1.2M`: the bar numbers and the axis. */
const compact = (n) => {
  if (Math.round(n) < 1000) return String(Math.round(n));
  const [div, unit] = n < 999_500 ? [1000, "k"] : [1e6, "M"];
  return `${+(n / div).toFixed(n / div < 9.95 ? 1 : 0)}${unit}`;
};
const grouped = (n) => n.toLocaleString("en-US");
/** The y axis: the smallest "nice" step (1, 2, 2.5, 5 × 10ⁿ, whole numbers only) that reaches `max` in at most 4 steps, and fewer steps in a short plot (22px apart at least). */
function yTicks(max, plotPx) {
  const most = Math.max(1, Math.min(4, Math.floor(plotPx / 22)));
  const m = Math.max(max, 1);
  for (let pow = Math.max(1, 10 ** Math.floor(Math.log10(m / most))); ; pow *= 10)
    for (const f of [1, 2, 2.5, 5]) if (Number.isInteger(f * pow) && Math.ceil(m / (f * pow)) <= most) return Array.from({ length: Math.ceil(m / (f * pow)) + 1 }, (_, i) => i * f * pow);
}
const ago = (s) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} m ${String(s % 60).padStart(2, "0")} s`);
/** Where the number of a bar goes: above it, inside it, or nowhere (it does not fit). */
function numberPlace(value, barPx, plotPx, slotPx) {
  if (!value || slotPx < 12) return undefined;
  const len = compact(value).length * 6 + 6;
  if (plotPx - barPx >= len) return "above";
  if (barPx >= len && slotPx - 2 >= 12) return "in";
  return undefined;
}

/**
 * o: { series: "total" | "toWidget" | "fromWidget", plot: [width, height] of the plot area in px (it decides how many
 *   bars there are and which numbers fit), hover: index of the hovered bar from the right, null for none }
 */
function statsPanel({ series = "total", plot = [589, 152], hover = 9 } = {}) {
  const [pw, ph] = plot;
  const n = Math.max(1, Math.min(60, Math.floor(pw / 14)));
  const to = STATS_TO.slice(-n);
  const from = STATS_FROM.slice(-n);
  const total = to.map((v, i) => v + from[i]);
  const values = { total, toWidget: to, fromWidget: from }[series];
  const [, cls, , , spoken] = SERIES.find(([k]) => k === series);
  const ticks = yTicks(Math.max(...values), ph);
  const top = ticks.at(-1) + 0.2 * ticks[1];
  const slot = pw / n;
  const W = 100 / n;
  const H = (v) => (v / top) * 100;
  const hi = hover == null ? undefined : n - 1 - hover;
  const tile = (v, l, sub = "") => `<div class="stat"><b>${v}</b><span>${l}</span>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const bars = values
    .map((v, i) => {
      const place = numberPlace(v, (H(v) / 100) * ph, ph, slot);
      const bar = `<i class="bar ${cls} ${i === hi ? "on" : ""}" style="left:${(i * W).toFixed(3)}%;width:calc(${W.toFixed(3)}% - 2px);height:${H(v).toFixed(2)}%"></i>`;
      const pos = place === "above" ? `bottom:calc(${H(v).toFixed(2)}% + 3px)` : `top:calc(${(100 - H(v)).toFixed(2)}% + 3px)`;
      return bar + (place ? `<span class="bar-n ${place === "in" ? "in" : ""}" style="left:calc(${((i + 0.5) * W).toFixed(3)}% - 1px);${pos}">${compact(v)}</span>` : "");
    })
    .join("");
  const tip =
    hi === undefined
      ? ""
      : `<div class="tip" style="right:calc(${(100 - hi * W).toFixed(3)}% + 4px)"><span>${hover * 5} s ago</span><b><i class="sw s1"></i>to widget ${grouped(to[hi])}</b><b><i class="sw s2"></i>from widget ${grouped(from[hi])}</b><b><i class="sw s0"></i>total ${grouped(total[hi])}</b></div>`;
  return `<div class="stats"><div class="stat-grid">${tile("42", "actions sent", "27 from widget · 15 to widget")}${tile("3 m 12 s", "run duration", "since notify_ready")}${tile("128", "events shared with the widget")}${tile("7", "events sent from the widget")}</div>
    <figure class="chart" aria-label="Characters sent over the widget API per 5 seconds: ${spoken}, the last ${ago(n * 5)}. Now: ${grouped(values[n - 1])}."><div class="chart-h"><span class="chart-t">Characters over the widget API <i>per 5 s</i></span><span class="chart-sel" role="radiogroup" aria-label="Graph">${SERIES.map(([k, c, l, t]) => `<button class="chip sm ${k === series ? "on" : ""}" role="radio" aria-checked="${k === series}" tabindex="${k === series ? 0 : -1}"><i class="sw ${c}"></i>${l} <b>${t}</b></button>`).join("")}</span></div>
    <div class="plot">
      <div class="plot-y">${ticks.map((t) => `<span style="bottom:${H(t).toFixed(2)}%">${compact(t)}</span>`).join("")}</div>
      <div class="plot-area">${ticks.map((t) => `<i class="gridl" style="bottom:${H(t).toFixed(2)}%"></i>`).join("")}${bars}${tip}</div>
      <div class="plot-x"><span>-${ago(n * 5)}</span><span>now</span></div>
    </div></figure></div>`;
}

function driverPanel() {
  const caps = [
    "widget:org.matrix.mscXXXX.get_matrix_context",
    "widget:org.matrix.mscXXXX.get_client_context",
    "widget:org.matrix.mscXXXX.read_events.timeline:m.room.message",
    "widget:org.matrix.mscXXXX.send_event.timeline:m.room.message",
    "widget:org.matrix.mscXXXX.send_event.delayed",
    "host:org.matrix.mscXXXX.update_theme",
  ];
  return `<div class="driver"><div class="dt-sub"><span>Approved capabilities <em>${caps.length}</em></span>${btn("Revoke all", { sm: true })}</div>
    <div class="caps">${caps.map((c) => `<div class="cap"><span class="cap-side ${c.startsWith("host") ? "host" : ""}">${c.split(":")[0]}</span><span class="cap-n">${c.slice(c.indexOf(":") + 1)}</span>${ibtn("x", "Revoke this capability", "xs")}</div>`).join("")}
      <div class="cap denied"><span class="cap-side">widget</span><span class="cap-n">org.matrix.mscXXXX.send_to_device:org.example.ping</span><span class="pill">denied</span>${btn("Approve", { sm: true })}</div></div>
    <div class="cap-add"><span class="input mono sm"><span class="ph">widget:org.matrix.mscXXXX.…</span></span>${btn("Add", { sm: true, ico: "plus" })}</div>
    <div class="dt-sub"><span>Mock a host action</span><span class="pill">TODO: more actions</span></div>
    <div class="mock-acts">${btn("Update theme", { sm: true, ico: "sun" })}<span class="seg sm"><span class="on">dark</span><span>light</span></span>${btn("Update language", { sm: true, ico: "globe" })}<span class="input mono sm narrow">en-GB</span>${btn("Update visibility", { sm: true, ico: "eye" })}<span class="seg sm"><span class="on">visible</span><span>hidden</span></span></div></div>`;
}

function consolePanel() {
  const lines = [
    ["log", "12:04:31.090", "[call] widget api: connecting to host"],
    ["log", "12:04:31.141", "[call] capabilities granted (6)"],
    ["info", "12:04:31.512", "[call] loaded 20 timeline events"],
    ["warn", "12:04:33.020", "[livekit] publishing without simulcast: codec vp9 not supported"],
    ["log", "12:04:33.871", "[call] sent m.room.message $evt1"],
    ["error", "12:04:38.091", "WidgetApiError: missing capability widget:org.matrix.mscXXXX.send_to_device:org.example.ping"],
    ["error", "12:04:38.092", "    at WidgetApi.request (widget-api.js:214:11)"],
    ["log", "12:04:40.007", "[call] always on screen: true"],
  ];
  return `<div class="dt-tools"><span class="input search sm">${icon("search", 11)}<span class="ph">Filter</span></span><span class="chip sm on">log</span><span class="chip sm on">info</span><span class="chip sm on">warn</span><span class="chip sm on">error</span><span class="sp"></span><span class="muted">forwarded by the widget SDK</span>${btn("Clear", { sm: true })}</div><div class="console">${lines.map(([lvl, t, text]) => `<div class="cl ${lvl}"><span class="cl-l">${lvl}</span><span class="cl-t">${t}</span><span class="cl-m">${esc(text)}</span></div>`).join("")}</div>`;
}

function dtPanel(kind, { expanded = false, stats } = {}) {
  const body = { messages: () => messagesPanel(expanded), stats: () => statsPanel(stats), driver: driverPanel, console: consolePanel }[kind]();
  return `<section class="dt-panel dtp-${kind}"><header class="dt-ph">${icon(DT[kind][0], 12)}<span>${DT[kind][1]}</span><span class="sp"></span>${ibtn("x", `Close ${DT[kind][1]}`, "xs")}</header><div class="dt-pb">${body}</div></section>`;
}

/**
 * dev: { dock: "top" | "bottom" | "left" | "right", panels: kind[] (at most 3, oldest first), expanded?: bool, size?: px,
 *   stats?: the options of statsPanel }
 * The bar is at the outer edge, the panels between it and the widget.
 */
export function devToolBar({ dock = "top", panels = [], expanded = false, size, stats } = {}) {
  if (panels.length > 3) throw new Error("at most three dev tool panels are open: opening a fourth closes the oldest");
  const open = new Set(panels);
  const vertical = dock === "left" || dock === "right";
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const bar = `<div class="dt-bar" role="toolbar" aria-label="Widget dev tools" aria-orientation="${vertical ? "vertical" : "horizontal"}"><span class="dt-title"><i class="dot ok" role="img" aria-label="Widget is ready" title="Widget is ready"></i><span>Dev tools</span></span>${Object.entries(DT)
    .map(([k, [ico, label]]) => `<button class="dt-btn ${open.has(k) ? "on" : ""}" aria-pressed="${open.has(k)}" title="${label}" aria-label="${k === "messages" ? "Messages, 42" : k === "console" ? "Console, 2 errors" : label}">${icon(ico, 13)}<span>${label}</span>${k === "messages" ? "<em>42</em>" : k === "console" ? `<em class="err">${icon("alert", 9)}2</em>` : ""}</button>`)
    .join("")}<span class="sp"></span><button class="dt-ib dt-reload" title="Reload the widget" aria-label="Reload the widget">${icon("refresh", 13)}</button><span class="dt-dock" role="radiogroup" aria-label="Dock position">${["left", "top", "bottom", "right"].map((d) => `<button class="dt-ib ${d === dock ? "on" : ""}" role="radio" title="Dock to the ${d}" aria-label="Dock to the ${d}" aria-checked="${d === dock}">${icon("dock" + cap(d), 13)}</button>`).join("")}</span><button class="dt-ib" title="Close the dev tools" aria-label="Close the dev tools">${icon("x", 13)}</button></div>`;
  const split = `<div class="dt-split" role="separator" aria-orientation="${vertical ? "horizontal" : "vertical"}" aria-label="Resize the dev tool panels" aria-valuenow="50" aria-valuemin="15" aria-valuemax="85" tabindex="0" title="Drag or use the arrow keys to resize · double click or Enter to reset"></div>`;
  const body = open.size
    ? `<div class="dt-panels" style="${vertical ? "width" : "height"}:${size ?? (vertical ? 340 : 250)}px">${panels.map((p) => dtPanel(p, { expanded, stats })).join(split)}</div><div class="dt-resize" role="separator" aria-orientation="${vertical ? "vertical" : "horizontal"}" aria-label="Resize the dev tools" aria-valuenow="40" aria-valuemin="15" aria-valuemax="85" tabindex="0" title="Drag or use the arrow keys to resize · double click or Enter to reset"><i></i></div>`
    : "";
  return `<div class="dt dt-${dock}">${bar}${body}</div>`;
}

/**
 * o: { kind: widget key, state: "ready" | "loading" | "failed" | "prompt", dev?: see devToolBar, compact? }
 */
export function widgetView({ kind = "call", state = "ready", dev = null, compact = false } = {}) {
  const name = WIDGETS[kind].name;
  let content;
  if (state === "loading") content = `<div class="wv-state"><span class="spinner" role="status" aria-label="Loading"></span><b>Loading ${name}…</b><span class="muted">Waiting for the widget to report that it is ready.</span></div>`;
  else if (state === "failed")
    content = `<div class="wv-state">${icon("alert", 30, "danger")}<b>${name} could not be loaded</b><span class="muted">The widget did not answer within 15 seconds.</span><code>https://${WIDGETS[kind].host}/room · no notify_ready</code><div class="inline-row">${btn("Retry", { ico: "refresh", kind: "primary" })}${btn("Close tab")}</div></div>`;
  else if (state === "prompt") {
    const perms = [
      ["Know who you are and which room this is", "get_matrix_context", true],
      ["Read the messages of this room", "read_events.timeline:m.room.message", true],
      ["Send messages to this room", "send_event.timeline:m.room.message", true],
      ["Send delayed events", "send_event.delayed", true],
      ["Send to-device messages", "send_to_device:org.example.ping", false],
    ];
    content = `<div class="wv-state"><div class="prompt-card" role="group" aria-labelledby="perm-t">${wico(kind, 40)}<b id="perm-t">${name} asks for permissions</b><span class="muted">Choose what this widget may do in this room. Nothing is shared before you approve.</span><div class="perm-list">${perms
      .map(([label, cap, on]) => `<label class="perm"><span class="check ${on ? "on" : ""}" role="checkbox" aria-checked="${on}" tabindex="0">${on ? icon("check", 12) : ""}</span><span><b>${label}</b><small class="mono">${cap}</small></span></label>`)
      .join("")}</div><div class="inline-row">${btn("Deny all")}<span class="sp"></span>${btn("Approve 4 selected", { kind: "primary" })}</div></div></div>`;
  } else content = widget(kind, { compact });
  return `<div class="wv dock-${dev?.dock ?? "none"}">${dev ? devToolBar(dev) : ""}<div class="wv-widget">${content}</div></div>`;
}

// ---------------------------------------------------------------------------------------------
// PictureInPicturePanel

/**
 * items: the visible boxes [{ room, widget, dev? }]; more: the widgets that do not fit [{ room, widget }];
 * dir: "h" | "v"; hover: show the surrounding box; menu: the overflow menu is open
 */
export function pip({ items, more = [], dir = "h", hover = false, menu = false, box = [224, 140], style = "" }) {
  const [w, h] = box;
  const stop = (it) => ibtn("x", `Close ${WIDGETS[it.widget].name}: stops the widget`, "xs");
  const cell = (it) => {
    const boxHtml = `<div class="pip-box" style="width:${w}px;height:${h}px">${widgetView({ kind: it.widget, dev: it.dev, compact: !it.dev && w < 300 })}</div>`;
    if (!hover) return boxHtml;
    return `<div class="pip-cell" style="width:${w}px"><div class="pip-label"><span class="pip-names"><small>${ROOMS[it.room].name}</small><b>${WIDGETS[it.widget].name}</b></span>${ibtn("goToTab", "Jump to the widget: opens its tab, which takes it out of this panel", "xs")}${it.dev ? ibtn("dots", "Close the widget dev tools", "xs on") : ""}${stop(it)}</div>${boxHtml}</div>`;
  };
  const moreTile = more.length ? `<button class="pip-more ${menu ? "on" : ""}" style="${dir === "h" ? `height:${h}px` : `width:${w}px`}" title="${more.length} more always-on-screen widgets" aria-label="${more.length} more always-on-screen widgets" aria-haspopup="menu" aria-expanded="${menu}">+${more.length}</button>` : "";
  const moreMenu = menu
    ? `<div class="dropdown pip-menu" role="menu" aria-label="More always-on-screen widgets">${more.map((it) => `<div class="dd-row" role="menuitem">${wico(it.widget, 22)}<span><b>${WIDGETS[it.widget].name}</b><small>${ROOMS[it.room].name}</small></span>${ibtn("goToTab", "Jump to the widget", "xs")}${stop(it)}</div>`).join("")}</div>`
    : "";
  const shellHead = hover
    ? `<div class="pip-grip" title="Drag to move">${icon("grip", 14)}<span>Always on screen</span><span class="sp"></span>${ibtn(dir === "h" ? "rows" : "columns", dir === "h" ? "Stack vertically" : "Stack horizontally", "xs")}</div>`
    : "";
  return `<aside class="pip ${dir} ${hover ? "hover" : ""}" style="${style}" aria-label="Always on screen widgets">${shellHead}${moreMenu}<div class="pip-list">${items.map(cell).join("")}${moreTile}</div>${hover ? '<i class="pip-resize" title="Drag to resize"></i>' : ""}</aside>`;
}

// ---------------------------------------------------------------------------------------------
// App shell, login, modal

/**
 * o: { leftBar?: props | null, side?: html, panels: html[], pip?: html, fence?, modal?, toast?, expand?, narrow?, cls? }
 */
export function app(o) {
  const side = o.side ? `<div class="sidecol">${o.side}</div>` : "";
  return `<div class="app ${o.fence ? "fence" : ""} ${o.narrow ? "narrow" : ""} ${o.cls ?? ""}">
    ${o.leftBar ? leftBar(o.leftBar) : ""}
    ${o.narrow && o.side ? '<div class="scrim side-scrim"></div>' : ""}${side}
    <main class="roomsarea">${(o.panels ?? []).join("")}${(o.panels ?? []).length ? "" : `<div class="area-empty">${icon("grid", 28)}<b>No room panel open</b><p>${o.fence ? "Open a mocked room to start. Your real rooms are untouched and come back when you leave the DevBackend." : "Open a room to see its widgets."}</p>${btn("New room panel", { kind: "primary", ico: "plus" })}<span class="muted"><kbd>Alt</kbd> + <kbd>N</kbd></span></div>`}</main>
    ${o.pager ? `<div class="pager" role="group" aria-label="Room panels">${ibtn("arrowLeft", "Previous room panel", "xs")}<span><b>${o.pager[0]}</b> · ${o.pager[1]}</span>${ibtn("arrowRight", "Next room panel", "xs")}</div>` : ""}
    ${o.expand ? `<button class="expand-btn" title="Show the left bar" aria-label="Show the left bar">${icon("panelOpen", 18)}</button>` : ""}
    ${o.fence && !o.leftBar ? `<span class="dev-badge">${icon("cone", 12)}DevBackend</span>` : ""}
    ${o.pip ?? ""}
    ${o.toast ? `<div class="toast" role="status">${o.toast}</div>` : ""}
    ${o.modal ? `<div class="scrim"></div>${o.modal}` : ""}
  </div>`;
}

export const confirmModal = () =>
  `<div class="modal sm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-t"><header>${icon("cone", 22, "dev")}<div><h2 id="confirm-t">Switch to the DevBackend?</h2></div></header>
    <p>Your <b>2 room panels</b> are closed and their widgets stop. They are opened again when you switch back to <b>Ada Okafor</b>.</p>
    <footer><span class="sp"></span>${btn("Cancel")}${btn("Switch to the DevBackend", { kind: "primary" })}</footer></div>`;

export const infoModal = () =>
  `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="about-t"><header>${logo(32)}<div><h2 id="about-t">Widget Host</h2><small>version 0.1.0 · matrix-js-sdk</small></div><span class="sp"></span>${ibtn("x", "Close")}</header>
    <p>A Matrix client that only does one thing: it opens the <b>widgets</b> of your rooms. Use it to run widgets next to each other, or to develop and debug your own.</p>
    <ul class="feat"><li>${icon("grid", 16)}<span><b>Rooms side by side.</b> Every room panel has tabs, one per widget.</span></li><li>${icon("pin", 16)}<span><b>Always on screen.</b> Widgets that ask for it float above everything.</span></li><li>${icon("terminal", 16)}<span><b>Dev tools.</b> See every message of the widget API, per widget.</span></li><li>${icon("cone", 16)}<span><b>DevBackend.</b> Mock rooms in memory and test a widget without a homeserver.</span></li></ul>
    <footer><a class="link">Documentation ${icon("external", 12)}</a><a class="link">Source code ${icon("external", 12)}</a><span class="sp"></span>${btn("Got it", { kind: "primary" })}</footer></div>`;

export const loginPage = () =>
  `<div class="app login-page"><div class="login-card">${logo(40)}<h1>Widget Host</h1><p class="muted">Sign in to open the widgets of your rooms.</p>
    ${field("Homeserver", "example.org")}${btn("Continue", { kind: "primary", block: true, end: "arrowRight" })}
    <p class="hint center">You sign in on your homeserver's own page. No password is entered here.</p>
    <div class="or"><span>or</span></div>
    <button class="skip">${icon("cone", 18)}<span><b>Skip login and use the DevBackend</b><small>In-memory rooms, no account needed. Enables the dev tools.</small></span>${icon("arrowRight", 16, "end")}</button></div></div>`;
