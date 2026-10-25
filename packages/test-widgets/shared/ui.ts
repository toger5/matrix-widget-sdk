/** The few DOM helpers both test widgets share. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = Object.assign(document.createElement(tag), props);
  element.append(...children);
  return element;
}

/** A button whose handler may return a promise; result or error is logged. */
export function button(label: string, onClick: () => unknown): HTMLButtonElement {
  return el("button", {
    textContent: label,
    onclick: () =>
      Promise.resolve()
        .then(onClick)
        .then((r) => r !== undefined && log(`${label} →`, r), (e) => log(`${label} failed`, String(e), true)),
  });
}

export function input(id: string, initial: string, labelText: string): HTMLLabelElement {
  return el("label", {}, labelText, el("input", { id, value: initial }));
}

export const valueOf = (id: string): string => (document.getElementById(id) as HTMLInputElement).value;

export function log(kind: string, data: unknown, error = false): void {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  document.getElementById("log")!.prepend(
    el("pre", { className: error ? "error" : "", textContent: `${new Date().toISOString().slice(11, 23)} ${kind} ${text}` }),
  );
}

export function showState(state: unknown): void {
  document.getElementById("state")!.textContent = JSON.stringify(state, null, 2);
}

export function mount(title: string, controls: Node[]): void {
  document.body.append(
    el("h1", { textContent: title }),
    el("div", {}, el("h2", { textContent: "actions" }), el("div", { id: "controls" }, ...controls), el("h2", { textContent: "state" }), el("pre", { id: "state" })),
    el("div", {}, el("h2", { textContent: "log (newest first)" }), el("div", { id: "log" })),
  );
}

export const DEFAULT_CAPABILITIES = [
  "org.matrix.msc2762.send.event:m.room.message",
  "org.matrix.msc2762.receive.event:m.room.message",
  "org.matrix.msc2762.send.state_event:m.room.topic",
  "org.matrix.msc2762.receive.state_event:m.room.topic",
].join(",");

/** Delayed (MSC4157) and sticky (MSC4407) sends, exercised by both widgets' extra buttons. */
export const DELAYED_CAPABILITIES = [
  "org.matrix.msc4157.send.delayed_event",
  "org.matrix.msc4157.update_delayed_event",
  "org.matrix.msc4407.send.sticky_event",
  "org.matrix.msc2762.send.event:m.rtc.member",
].join(",");

export const capabilityList = (): string[] => valueOf("caps").split(",").map((c) => c.trim()).filter(Boolean);

/** Reactions (MSC3869 relations) between the test widgets' own messages. */
export const RELATION_CAPABILITIES = [
  "org.matrix.msc2762.send.event:m.reaction",
  "org.matrix.msc2762.receive.event:m.reaction",
].join(",");

/** To-device messages (MSC3819) of one test type, both directions. */
export const TO_DEVICE_CAPABILITIES = [
  "org.matrix.msc3819.send.to_device:org.example.ping",
  "org.matrix.msc3819.receive.to_device:org.example.ping",
].join(",");
export const TO_DEVICE_MESSAGES = { "@bob:example.org": { "*": { hello: "from the widget" } } };

/** The read-style extras: TURN, RTC transports, user directory, media config, room account data, LiveKit. */
export const EXTRA_CAPABILITIES = [
  "town.robin.msc3846.turn_servers",
  "org.matrix.msc4515.rtc_transports",
  "org.matrix.msc3973.user_directory_search",
  "org.matrix.msc4039.upload_file",
  "com.beeper.capabilities.receive.room_account_data:m.tag",
  "org.matrix.msc4533.rtc_livekit_get_token",
].join(",");

/** Remembers the delay id of the last scheduled event so the update buttons have a target. */
export const lastDelay = { id: "" };
export const rememberDelay = <T extends { delay_id?: string } | string>(result: T): T => {
  lastDelay.id = typeof result === "string" ? result : (result.delay_id ?? lastDelay.id);
  return result;
};

/** Remembers the event id of the last immediate send, the target of reactions and relation reads. */
export const lastEvent = { id: "" };
export const rememberEvent = <T extends { event_id?: string }>(result: T): T => {
  if (result.event_id) lastEvent.id = result.event_id;
  return result;
};
export const reactionTo = (eventId: string, key: string) => ({ "m.relates_to": { rel_type: "m.annotation", event_id: eventId, key } });
