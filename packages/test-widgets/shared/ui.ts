/**
 * The few DOM helpers both test widgets share. The capabilities each widget requests are its own:
 * `legacy/capabilities.ts` (matrix-widget-api names) and `new/capabilities.ts`.
 */

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

export const capabilityList = (): string[] => valueOf("caps").split(",").map((c) => c.trim()).filter(Boolean);

export const TO_DEVICE_MESSAGES = { "@bob:example.org": { "*": { hello: "from the widget" } } };

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

/** The demo image the widget test host puts into its in-memory media repository. */
export const DEMO_CONTENT_URI = "mxc://example.org/demo-landscape";

/** How a widget moves files; both widgets adapt their API to plain `Blob`s. */
export interface FileOps {
  download(contentUri: string): Promise<Blob>;
  upload(file: Blob): Promise<string>;
}

/**
 * Controls for MSC4039 files: download an `mxc://` URI (previewed below the buttons), upload the
 * last download again, or upload a file chosen from disk. Uploading puts the new URI into the
 * input, so the file can be downloaded straight back.
 */
export function fileControls(ops: FileOps): Node[] {
  let last: Blob | undefined;
  const chooser = el("input", { type: "file", id: "chooser" });
  const uploaded = (contentUri: string) => {
    (document.getElementById("contentUri") as HTMLInputElement).value = contentUri;
    return { content_uri: contentUri };
  };
  return [
    input("contentUri", DEMO_CONTENT_URI, "mxc uri"),
    button("download_file", async () => {
      const uri = valueOf("contentUri");
      last = await ops.download(uri);
      showFile(uri, last);
      return { content_uri: uri, mimetype: last.type, size: last.size };
    }),
    button("upload_file: last download", () => {
      if (!last) throw new Error("download a file first");
      return ops.upload(last).then(uploaded);
    }),
    el("label", {}, "file", chooser),
    button("upload_file: chosen file", () => {
      const file = chooser.files?.[0];
      if (!file) throw new Error("choose a file first");
      return ops.upload(file).then(uploaded);
    }),
    el("div", { id: "files" }),
  ];
}

/** The downloaded file: images are shown, anything else gets a save link. */
function showFile(contentUri: string, file: Blob): void {
  const url = URL.createObjectURL(file);
  const caption = el("div", {}, `${contentUri} · ${file.type || "unknown type"} · ${file.size} bytes `);
  const body = file.type.startsWith("image/")
    ? el("img", { src: url, alt: contentUri })
    : el("a", { href: url, download: contentUri.split("/").pop() ?? "file", textContent: "save file" });
  document.getElementById("files")!.replaceChildren(caption, body);
}
