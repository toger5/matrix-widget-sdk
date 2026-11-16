/** Small formatters of the dev tool panels and the capability prompt. Pure functions. */

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** `12:04:31.102`, local time: the time column of the message log and the console. */
export function clock(timestamp: number): string {
  const d = new Date(timestamp);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** `42 s`, `3 m 12 s`, `2 h 03 m`, `4 d 07 h`. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} m ${pad(s % 60)} s`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${pad(Math.floor((s % 3600) / 60))} m`;
  return `${Math.floor(s / 86400)} d ${pad(Math.floor((s % 86400) / 3600))} h`;
}

/** Splits an action or capability name into its namespace prefix (`org.matrix.mscXXXX.`, `m.`) and the rest. */
export function splitNamespace(name: string): [prefix: string, rest: string] {
  const m = /^((?:org\.matrix\.msc[0-9a-z]+|m)\.)(.+)$/i.exec(name);
  return m ? [m[1], m[2]] : ["", name];
}

/** `widget:org.matrix.mscXXXX.send_event.timeline:m.room.message` → side `widget`, name `org.matrix…`. */
export function splitCapability(capability: string): { side: string; name: string } {
  const i = capability.indexOf(":");
  const side = i > 0 ? capability.slice(0, i) : "";
  return side === "widget" || side === "host" ? { side, name: capability.slice(i + 1) } : { side: "", name: capability };
}

// ---------------------------------------------------------------------------------------------
// The capability prompt: sections, labels, risky capabilities and the summary sentence. This is
// the only source of the copy (`test/capabilityFormat.test.ts` checks it against the test widget).
// TODO-FINDING capability-labels-in-view - the human labels are a table in the view, keyed by the action name without namespace; whether a capability is known at all comes from the driver (`CapabilityPromptViewModel.unknown`). The SDK (or the view model) could provide the labels; they change with the capability naming proposal

export type CapabilitySectionId = "read" | "send" | "state" | "devices" | "account" | "files" | "calls" | "app" | "other";

/** A section of the prompt: title, the phrase of the summary sentence, the capabilities (`<source>:<action name>[.<modifier>]`) that belong to it. */
interface SectionDef {
  id: CapabilitySectionId;
  title: string;
  phrase: string;
  members: string[];
}

/** The sections in their order. A capability of none of them is "Unknown to this app" (last). */
const SECTIONS: SectionDef[] = [
  { id: "read", title: "Read this room", phrase: "read this room", members: ["widget:read_events", "widget:read_relations", "host:forward_event", "host:update_state"] },
  { id: "send", title: "Send as you", phrase: "send messages as you", members: ["widget:send_event.timeline", "widget:send_event.delayed", "widget:send_event.sticky", "widget:update_delayed_event"] },
  { id: "state", title: "Change the room", phrase: "change the room for everyone", members: ["widget:send_event.state"] },
  { id: "devices", title: "Direct messages to devices", phrase: "exchange hidden messages with devices", members: ["widget:send_to_device", "host:forward_to_device"] },
  { id: "account", title: "You and your account", phrase: "know who you are", members: ["widget:get_matrix_context", "widget:get_openid", "widget:search_user_directory", "widget:read_room_account_data"] },
  { id: "files", title: "Files", phrase: "work with files", members: ["widget:get_media_config", "widget:upload_file", "widget:download_file"] },
  { id: "calls", title: "Calls", phrase: "join calls", members: ["widget:get_rtc_transports", "widget:get_rtc_livekit_token", "widget:delegate_rtc_livekit_delayed_leave", "host:update_turn_servers"] },
  { id: "app", title: "This app", phrase: "adapt to this app", members: ["widget:get_client_context", "widget:navigate", "widget:set_always_on_screen", "host:update_theme", "host:update_language", "host:update_visibility"] },
  { id: "other", title: "Unknown to this app", phrase: "ask for things this app does not know", members: [] },
];

/** Risky capabilities: the text of their warning icon. */
const RISKS: Record<string, string> = {
  "widget:send_event.timeline": "Acts in your name",
  "widget:send_event.state": "Changes the room for everyone",
  "widget:send_to_device": "Hidden from the room",
  "widget:get_openid": "Proves your identity to other servers",
};
/** The phrase of "You and your account" when it holds `get_openid`. */
const OPENID_PHRASE = "prove who you are to other servers";

const q = (type: string) => `“${type}”`;
/** The label of each capability; `t` is its data (the event type). */
const LABELS: Record<string, (t: string) => string> = {
  "widget:read_events.timeline": (t) => (t === "m.room.message" ? "Read the messages of this room" : `Read ${q(t)} events of this room`),
  "widget:read_events.state": (t) => `Read the ${q(t)} state of this room`,
  "widget:read_relations": (t) => `Read ${q(t)} events that refer to a message`,
  "host:forward_event.timeline": (t) => (t === "m.room.message" ? "Receive new messages of this room" : `Receive new ${q(t)} events`),
  "host:forward_event.state": (t) => `Receive changes of the ${q(t)} state`,
  "host:forward_event.sticky": () => "Receive sticky events",
  "host:update_state": (t) => `Be told the current ${q(t)} state`,
  "widget:send_event.timeline": (t) => (t === "m.room.message" ? "Send messages to this room" : `Send ${q(t)} events to this room`),
  "widget:send_event.state": (t) => `Change the ${q(t)} state of this room`,
  "widget:send_event.delayed": () => "Send events with a delay",
  "widget:send_event.sticky": () => "Send sticky events",
  "widget:update_delayed_event": () => "Change or cancel delayed events",
  "widget:send_to_device": (t) => `Send ${q(t)} messages to devices`,
  "host:forward_to_device": (t) => `Receive ${q(t)} messages from devices`,
  "widget:get_matrix_context": () => "Know who you are and which room this is",
  "widget:get_openid": () => "Prove who you are to other servers (OpenID)",
  "widget:search_user_directory": () => "Search the user directory",
  "widget:read_room_account_data": (t) => `Read your ${q(t)} data of this room`,
  "widget:get_media_config": () => "Know the upload limits",
  "widget:upload_file": () => "Upload files",
  "widget:download_file": () => "Download files",
  "widget:get_rtc_transports": () => "Find the call servers",
  "widget:get_rtc_livekit_token": () => "Join calls on LiveKit servers",
  "widget:delegate_rtc_livekit_delayed_leave": () => "Leave calls for you when the connection drops",
  "host:update_turn_servers": () => "Be told the TURN servers for calls",
  "widget:get_client_context": () => "Know the theme and language of this app",
  "widget:navigate": () => "Open links to rooms and users",
  "widget:set_always_on_screen": () => "Stay on screen while you use other tabs",
  "host:update_theme": () => "Be told when the theme changes",
  "host:update_language": () => "Be told when the language changes",
  "host:update_visibility": () => "Be told when it is shown or hidden",
};

/**
 * `widget:org.matrix.msc2876.read_events.timeline:m.room.message` → key
 * `widget:read_events.timeline`, data `m.room.message`. The namespace is not checked (the driver
 * decides what is known); `undefined` if the action is none of the table.
 */
function capabilityKind(capability: string): { key: string; data: string } | undefined {
  const m = /^(widget|host):([^:]+)(?::(.*))?$/.exec(capability);
  if (!m) return undefined;
  const [, source, action, data = ""] = m;
  const parts = action.split(".");
  // The action name is the last segment, or the last two with a modifier (`send_event.timeline`);
  // at least one segment before it is the namespace.
  for (const n of [2, 1]) {
    const key = `${source}:${parts.slice(-n).join(".")}`;
    if (parts.length > n && key in LABELS) return { key, data };
  }
  return undefined;
}

/** A sentence for a capability of the widget API; `undefined` for anything else (the prompt then shows only the capability itself). */
export function capabilityLabel(capability: string): string | undefined {
  const kind = capabilityKind(capability);
  return kind && LABELS[kind.key](kind.data);
}

/** Why a capability is risky (the text of its warning icon), or `undefined`. */
export function capabilityRisk(capability: string): string | undefined {
  const kind = capabilityKind(capability);
  return kind && RISKS[kind.key];
}

/** The section of a capability. `known: false` (the driver does not know it): "Unknown to this app", whatever its name. */
export function capabilitySection(capability: string, known = true): CapabilitySectionId {
  const kind = known ? capabilityKind(capability) : undefined;
  if (!kind) return "other";
  const action = kind.key.split(".")[0];
  return SECTIONS.find((s) => s.members.includes(kind.key) || s.members.includes(action))?.id ?? "other";
}

export interface CapabilitySection {
  id: CapabilitySectionId;
  title: string;
  /** Its part of the summary sentence. */
  phrase: string;
  /** Its capabilities, in the order they were requested. */
  capabilities: string[];
  /** One of them is risky: the phrase comes first and in bold, the header has a warning icon. */
  risky: boolean;
}

/** The sections that hold one of `requested`, in their fixed order. `unknown`: those the driver does not know. */
export function capabilitySections(requested: readonly string[], unknown: readonly string[] = []): CapabilitySection[] {
  return SECTIONS.flatMap(({ id, title, phrase }) => {
    const capabilities = requested.filter((c) => capabilitySection(c, !unknown.includes(c)) === id);
    if (capabilities.length === 0) return [];
    const n = capabilities.length;
    const openId = capabilities.some((c) => capabilityKind(c)?.key === "widget:get_openid");
    return [
      {
        id,
        title,
        phrase: id === "other" ? `ask for ${n === 1 ? "one thing" : `${n} things`} this app does not know` : openId ? OPENID_PHRASE : phrase,
        capabilities,
        risky: id !== "other" && capabilities.some((c) => capabilityRisk(c) !== undefined),
      },
    ];
  });
}

/**
 * "<name> wants to <phrases>.": the phrases of the sections, the risky ones first and bold. As
 * parts, so that the view can set the bold ones.
 */
export function capabilitySummary(name: string, sections: readonly CapabilitySection[]): { text: string; bold?: boolean }[] {
  const phrases = [...sections.filter((s) => s.risky), ...sections.filter((s) => !s.risky)];
  const parts: { text: string; bold?: boolean }[] = [{ text: `${name} wants to ` }];
  phrases.forEach((s, i) => {
    if (i > 0) parts.push({ text: i === phrases.length - 1 ? " and " : ", " });
    parts.push(s.risky ? { text: s.phrase, bold: true } : { text: s.phrase });
  });
  parts.push({ text: "." });
  return parts;
}
