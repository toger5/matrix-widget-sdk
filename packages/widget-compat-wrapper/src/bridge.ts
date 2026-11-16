/**
 * The protocol bridge: a legacy widget on one side, an MSC4412 host on the other.
 *
 * Most messages are only re-enveloped (envelope.ts) and forwarded. The bridge does four things
 * itself:
 *
 * 1. **Bootstrap.** A legacy widget URL contains template variables (`$matrix_user_id`, ...).
 *    Before loading the widget, the bridge asks the host for the `get_matrix_context` and
 *    `get_client_context` capabilities, fetches both contexts and fills in the URL (template.ts).
 *    If the host refuses, the variables stay empty and the widget still loads. A templated URL
 *    that is not an absolute http(s) URL is never loaded (url.ts).
 * 2. **Startup handshake.** The two protocols start differently:
 *    - Legacy capabilities are requested by the host (`capabilities` to the widget). MSC4412
 *      capabilities are requested by the widget (`request_capabilities`). The bridge plays the
 *      legacy host: it asks the widget, then requests the result from the real host.
 *    - A legacy host starts that round on the iframe `load` event (`waitForIframeLoad: true`)
 *      or on the widget's `content_loaded` (`waitForIframeLoad: false`). The bridge does the same,
 *      and tells the real host `notify_ready` at that moment.
 *    - The legacy widget asks `supported_api_versions`, which MSC4412 does not have. The bridge
 *      answers it.
 * 3. **Capabilities.** The widget asks for legacy capabilities; the host only knows the new ones.
 *    The bridge requests what each legacy capability stands for, plus what the legacy api allowed
 *    without asking, and translates the host's answer back (capabilities.ts): the host's
 *    `update_capabilities { allowed }` becomes the legacy `notify_capabilities
 *    { requested, approved }`.
 * 4. **Files.** Legacy widgets send files as `Blob`; MSC4412 hosts expect base64 (files.ts).
 *
 * The class does no I/O. It is driven by `start`, `onIframeLoad`, `onWidgetMessage` and
 * `onHostMessage`, and sends through the callbacks in {@link BridgeOptions}.
 */
import { CurrentApiVersions } from "matrix-widget-api";

import { capabilitiesToRequest, collapseApproved, widgetCapability } from "./capabilities";
import {
  ERROR_INVALID_REQUEST,
  errorBody,
  isErrorBody,
  isLegacyMessage,
  isNewMessage,
  legacyRequestToNew,
  legacyResponse,
  legacyResponseBodyToNew,
  newErrorBody,
  newRequestToLegacy,
  newResponse,
  NOTIFY_READY_ACTION,
  PLACEHOLDER,
  REQUEST_CAPABILITIES_ACTION,
  toNewAction,
  UPDATE_CAPABILITIES_ACTION,
  type LegacyMessage,
  type NewMessage,
} from "./envelope";
import { DOWNLOAD_FILE_ACTION, downloadResponseToLegacy, UPLOAD_FILE_ACTION, uploadRequestToNew } from "./files";
import type { ClientContext, MatrixContext } from "./template";
import { templatedLegacyUrl } from "./url";
import { log } from "./log";

/** The context actions, in the unstable spelling the host emits (`docs/parity.md`). */
export const MATRIX_CONTEXT_ACTION = `${PLACEHOLDER}.get_matrix_context`;
export const CLIENT_CONTEXT_ACTION = `${PLACEHOLDER}.get_client_context`;
/** The capabilities for the context actions. */
export const CONTEXT_CAPABILITIES = [widgetCapability("get_matrix_context"), widgetCapability("get_client_context")];

const capabilitiesOf = (body: unknown): string[] => {
  const list = (body as { capabilities?: unknown } | undefined)?.capabilities;
  return Array.isArray(list) ? list.filter((c): c is string => typeof c === "string") : [];
};

export interface BridgeOptions {
  /** The `widgetId` the legacy widget expects on every message (the legacy state event's `state_key`). */
  widgetId: string;
  /** The legacy widget's `waitForIframeLoad` setting (legacy default: `true`). */
  waitForIframeLoad: boolean;
  /** The legacy widget URL with its template variables still in it (`content.url`). */
  legacyWidgetUrl: string;
  /** `content.data` of the legacy state event. Each key is an extra `$key` template variable. */
  widgetData?: Record<string, unknown>;
  /** URL of the wrapper page. The legacy widget gets it as `parentUrl`. */
  wrapperUrl: string;
  /** Post a message to the host (the wrapper's parent window). */
  sendToHost(message: NewMessage): void;
  /** Post a message to the legacy widget (the inner iframe). */
  sendToWidget(message: LegacyMessage): void;
  /** Load the templated legacy widget URL into the inner iframe: an absolute http(s) URL, checked (url.ts). Called at most once. */
  loadWidget(url: string): void;
  /** The templated URL is refused (`reason`, from url.ts): there is no widget. Called instead of `loadWidget`. */
  refuseWidget(reason: string): void;
  /** API versions announced to the widget. Default: matrix-widget-api's `CurrentApiVersions`. */
  supportedVersions?: string[];
  /** Generates the request ids of the bridge's own requests. Default: `crypto.randomUUID`. */
  nextId?: () => string;
}

/** Called with the response body of one of the bridge's own requests. */
type Responder = (response: unknown) => void;

/** Translates between one legacy widget and its MSC4412 host. See the module comment. */
export class CompatBridge {
  /** Widget requests forwarded to the host, by request id. A legacy reply repeats the request. */
  private readonly fromWidget = new Map<string, LegacyMessage>();
  /** Host requests forwarded to the widget, by request id. An MSC4412 reply repeats its header. */
  private readonly fromHost = new Map<string, NewMessage>();
  /** The bridge's own requests to either side, by request id. */
  private readonly own = new Map<string, Responder>();
  /** `bootstrap` until the inner iframe is loaded, then `running`; `refused` when its URL is. */
  private phase: "bootstrap" | "running" | "refused" = "bootstrap";
  /** The host got `notify_ready`. Sent once, even if the inner iframe reloads. */
  private readySentToHost = false;
  /** The widget sent `content_loaded` since its iframe last loaded. A second one is an error. */
  private contentLoadedFromWidget = false;
  /** The legacy capabilities of the widget's latest request, as the widget spelled them. */
  private legacyRequested: string[] = [];
  /** Every legacy capability the widget ever requested: the candidates for "approved". */
  private readonly legacyKnown = new Set<string>();

  constructor(private readonly o: BridgeOptions) {}

  /** Start the bootstrap by requesting the context capabilities. The host answers with `update_capabilities`. */
  start(): void {
    this.requestHost(REQUEST_CAPABILITIES_ACTION, { capabilities: CONTEXT_CAPABILITIES });
  }

  /** The inner iframe fired `load`. This also happens when the widget reloads itself. */
  onIframeLoad(): void {
    this.contentLoadedFromWidget = false;
    if (this.o.waitForIframeLoad) {
      this.sendReadyOnce();
      this.negotiateCapabilities();
    }
  }

  /** Handle `event.data` of a message from the inner iframe. Anything that is not for this widget is ignored. */
  onWidgetMessage(data: unknown): void {
    if (!isLegacyMessage(data) || data.widgetId !== this.o.widgetId) {
      return log.debug("ignored a message from the inner iframe that is not for this widget", data);
    }
    log.debug(`from widget: ${data.action} (${data.response !== undefined ? "response" : "request"} ${data.requestId})`);
    if (data.response !== undefined) return this.onWidgetResponse(data);
    if (data.api === "fromWidget") this.onWidgetRequest(data);
  }

  /** Handle `event.data` of a message from the parent window. Anything that is not MSC4412 is ignored. */
  onHostMessage(data: unknown): void {
    if (!isNewMessage(data)) return log.debug("ignored a message from the host that is not MSC4412", data);
    log.debug(`from host: ${data.action} (${data.response !== undefined ? "response" : "request"} ${data.request_id})`);
    if (data.response !== undefined) return this.onHostResponse(data);
    if (data.source === "host") this.onHostRequest(data);
  }

  // ---- bootstrap -----------------------------------------------------------------------------

  /** After the first `update_capabilities`: fetch both contexts, fill in the URL, load the widget. */
  private bootstrap(): void {
    const matrix: Partial<MatrixContext> = {};
    const client: ClientContext = {};
    let pending = 2;
    const done = () => {
      if (--pending > 0) return;
      const input = { widgetId: this.o.widgetId, wrapperUrl: this.o.wrapperUrl, matrix, client, data: this.o.widgetData };
      // Checked before and after templating: the templated URL is what the iframe loads (url.ts).
      const templated = templatedLegacyUrl(this.o.legacyWidgetUrl, input);
      if ("problem" in templated) {
        this.phase = "refused";
        log.error(`refused to load the legacy widget: ${templated.problem}`);
        return this.o.refuseWidget(templated.problem);
      }
      this.phase = "running";
      this.o.loadWidget(templated.url);
    };
    // An error reply (capability denied, action unknown to the host) leaves the variables empty.
    this.requestHost(MATRIX_CONTEXT_ACTION, {}, (r) => (isErrorBody(r) || Object.assign(matrix, r), done()));
    this.requestHost(CLIENT_CONTEXT_ACTION, {}, (r) => (isErrorBody(r) || Object.assign(client, r), done()));
  }

  // ---- widget -> host ------------------------------------------------------------------------

  private onWidgetRequest(m: LegacyMessage): void {
    switch (m.action) {
      case "supported_api_versions":
        // Answered here: an MSC4412 host does not know this action. The widget asks during its
        // start and again while answering `capabilities`.
        return this.o.sendToWidget(
          legacyResponse(m, { supported_versions: this.o.supportedVersions ?? CurrentApiVersions }),
        );
      case "content_loaded":
        return this.onWidgetContentLoaded(m);
      case UPLOAD_FILE_ACTION:
        // The file has to be read first, so the request goes out asynchronously.
        uploadRequestToNew(m.data).then(
          (data) => this.forwardToHost(m, data),
          (e: unknown) => this.o.sendToWidget(legacyResponse(m, errorBody(`Could not read the file: ${String(e)}`))),
        );
        return;
      default:
        if (toNewAction(m.action, "widget") === REQUEST_CAPABILITIES_ACTION) {
          // Renegotiation (MSC2974): the widget names its legacy capabilities itself.
          return this.forwardToHost(m, { capabilities: this.translateRequested(capabilitiesOf(m.data)) });
        }
        this.forwardToHost(m);
    }
  }

  /**
   * Forward a widget request, with `data` as its body if given. The original request is kept:
   * the widget's reply must echo it unchanged (with the widget's own `Blob`, for example).
   */
  private forwardToHost(m: LegacyMessage, data: unknown = m.data): void {
    this.fromWidget.set(m.requestId, m);
    this.o.sendToHost(legacyRequestToNew({ ...m, data }));
  }

  /** The widget's `content_loaded`, answered exactly as a legacy host would. */
  private onWidgetContentLoaded(m: LegacyMessage): void {
    if (this.contentLoadedFromWidget) {
      return this.o.sendToWidget(
        legacyResponse(m, errorBody("Improper sequence: ContentLoaded Action can only be sent once")),
      );
    }
    this.contentLoadedFromWidget = true;
    if (this.o.waitForIframeLoad) {
      // With `waitForIframeLoad` the iframe `load` event already did the job.
      return this.o.sendToWidget(legacyResponse(m, errorBody("Improper sequence: not expecting ContentLoaded event")));
    }
    this.o.sendToWidget(legacyResponse(m, {}));
    this.sendReadyOnce();
    this.negotiateCapabilities();
  }

  /** The host answered: either one of the bridge's own requests, or a forwarded widget request. */
  private onHostResponse(m: NewMessage): void {
    if (this.answerOwnRequest(m.request_id, m.response)) return;
    const request = this.fromWidget.get(m.request_id);
    if (!request) return log.warn(`dropped the host's response to ${m.action}: no request with id ${m.request_id}`);
    this.fromWidget.delete(m.request_id);
    const response = request.action === DOWNLOAD_FILE_ACTION ? downloadResponseToLegacy(m.response) : m.response;
    this.o.sendToWidget(legacyResponse(request, response));
  }

  // ---- host -> widget ------------------------------------------------------------------------

  private onHostRequest(m: NewMessage): void {
    if (this.phase === "refused") {
      log.warn(`refused ${m.action} from the host: the legacy widget's URL was refused`);
      return this.o.sendToHost(newResponse(m, newErrorBody(ERROR_INVALID_REQUEST, "The wrapped widget's URL was refused")));
    }
    if (this.phase === "bootstrap") {
      // There is no widget yet. The only host request expected is the reply to `start()`.
      if (m.action !== UPDATE_CAPABILITIES_ACTION) {
        log.warn(`refused ${m.action} from the host: the wrapped widget is not loaded yet`);
        const error = newErrorBody(ERROR_INVALID_REQUEST, "The wrapped widget is not loaded yet");
        return this.o.sendToHost(newResponse(m, error));
      }
      this.o.sendToHost(newResponse(m, {}));
      return this.bootstrap();
    }
    this.fromHost.set(m.request_id, m);
    const request = m.action === UPDATE_CAPABILITIES_ACTION ? this.translateUpdate(m.request) : m.request;
    this.o.sendToWidget(newRequestToLegacy({ ...m, request }, this.o.widgetId));
  }

  /** The widget answered: either one of the bridge's own requests, or a forwarded host request. */
  private onWidgetResponse(m: LegacyMessage): void {
    if (this.answerOwnRequest(m.requestId, m.response)) return;
    const request = this.fromHost.get(m.requestId);
    if (!request) return log.warn(`dropped the widget's response to ${m.action}: no request with id ${m.requestId}`);
    this.fromHost.delete(m.requestId);
    this.o.sendToHost(newResponse(request, legacyResponseBodyToNew(m.response)));
  }

  // ---- handshake -----------------------------------------------------------------------------

  /** Tell the host that the widget may be shown, at the moment a legacy host would show it. */
  private sendReadyOnce(): void {
    if (this.readySentToHost) return;
    this.readySentToHost = true;
    this.requestHost(NOTIFY_READY_ACTION, {});
  }

  /** Play the legacy host: ask the widget for its capabilities, then request them from the real host. */
  private negotiateCapabilities(): void {
    this.requestWidget("capabilities", {}, (response) => {
      const capabilities = this.translateRequested(capabilitiesOf(response));
      this.requestHost(REQUEST_CAPABILITIES_ACTION, { capabilities });
    });
  }

  // ---- capabilities --------------------------------------------------------------------------

  /** Remember the widget's legacy capabilities and return what to request from the host for them. */
  private translateRequested(legacy: string[]): string[] {
    this.legacyRequested = legacy;
    for (const capability of legacy) this.legacyKnown.add(capability);
    return capabilitiesToRequest(legacy);
  }

  /**
   * The body of the host's `update_capabilities { allowed }` as a legacy `notify_capabilities`:
   * `requested` is what the widget asked for last, `approved` every legacy capability it holds
   * now. `allowed` is always the full list, so `approved` shrinks when the host takes
   * capabilities away.
   */
  private translateUpdate(request: unknown): { requested: string[]; approved: string[] } {
    const allowed = (request as { allowed?: unknown } | undefined)?.allowed;
    return {
      requested: this.legacyRequested,
      approved: collapseApproved([...this.legacyKnown], Array.isArray(allowed) ? allowed : []),
    };
  }

  // ---- the bridge's own requests -------------------------------------------------------------

  private requestHost(action: string, request: unknown, onResponse: Responder = () => {}): void {
    const request_id = this.nextId();
    this.own.set(request_id, onResponse);
    this.o.sendToHost({ source: "widget", request_id, action, request });
  }

  private requestWidget(action: string, data: unknown, onResponse: Responder): void {
    const requestId = this.nextId();
    this.own.set(requestId, onResponse);
    this.o.sendToWidget({ api: "toWidget", widgetId: this.o.widgetId, requestId, action, data });
  }

  /** If `requestId` belongs to one of the bridge's own requests, pass `response` to its responder. */
  private answerOwnRequest(requestId: string, response: unknown): boolean {
    const responder = this.own.get(requestId);
    if (!responder) return false;
    this.own.delete(requestId);
    responder(response);
    return true;
  }

  private nextId(): string {
    return this.o.nextId ? this.o.nextId() : crypto.randomUUID();
  }
}
