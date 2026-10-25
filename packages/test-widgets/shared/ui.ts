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

export const capabilityList = (): string[] => valueOf("caps").split(",").map((c) => c.trim()).filter(Boolean);
