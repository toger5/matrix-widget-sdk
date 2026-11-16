/** Small formatters the dev tool panels and the capability prompt share. Pure functions. */

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

const eventsOf = (qualifier: string): string => {
  // qualifier: "", ".timeline", ".timeline:m.room.message", ".state:m.room.member", ".delayed", ":org.example.ping"
  const type = qualifier.includes(":") ? qualifier.slice(qualifier.indexOf(":") + 1) : "";
  if (qualifier.startsWith(".state")) return type ? `“${type}” state` : "the room state";
  if (type === "m.room.message") return "the messages";
  return type ? `“${type}” events` : "the events";
};

/**
 * A sentence for a capability, where one can be derived from the capability string; `undefined`
 * otherwise (the prompt then only shows the capability itself).
 */
export function capabilityLabel(capability: string): string | undefined {
  // TODO-FINDING capability-labels-in-view - the human labels are derived in the view from the action name with a hard-coded table; the SDK (or the view model) should provide them, and they change with the capability naming proposal
  const { side, name } = splitCapability(capability);
  const rest = splitNamespace(name)[1];
  const m = /^([a-z0-9_]+)(.*)$/i.exec(rest);
  if (!m) return undefined;
  const [, action, qualifier] = m;
  if (side === "host") {
    switch (action) {
      case "forward_event":
        return `Receive ${eventsOf(qualifier)} of this room`;
      case "update_theme":
        return "Be told when the theme changes";
      case "update_language":
        return "Be told when the language changes";
      case "update_visibility":
        return "Be told when it is shown or hidden";
      default:
        return undefined;
    }
  }
  switch (action) {
    case "get_matrix_context":
      return "Know who you are and which room this is";
    case "get_client_context":
      return "Know the theme and language of this app";
    case "read_events":
      return `Read ${eventsOf(qualifier)} of this room`;
    case "send_event":
      return qualifier === ".delayed" ? "Send delayed events" : `Send ${eventsOf(qualifier).replace(/^the /, "")} to this room`;
    case "send_to_device":
      return "Send to-device messages";
    case "get_openid":
      return "Ask for an OpenID token";
    case "set_always_on_screen":
      return "Stay on screen while you use other tabs";
    case "navigate":
      return "Open links to rooms and users";
    default:
      return undefined;
  }
}
