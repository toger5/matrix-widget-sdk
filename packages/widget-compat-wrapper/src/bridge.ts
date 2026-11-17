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
 *    that is not an absolute http(s) URL is never loaded (url.ts). In the same request it asks
 *    for the webview capabilities of a legacy client's iframe (`LEGACY_WEBVIEW_CAPABILITIES`), so
 *    that a host with strict iframes gives the wrapper's iframe what legacy widgets expect.
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
 * 5. **Reading events.** The host has no `read_events`: a timeline read becomes `read_timeline`
 *    reads (and `paginate_timeline` while the answer is short), a state read is answered from the
 *    host's `update_state` pushes (readEvents.ts). The host's `notify_timeline_update` is
 *    acknowledged here and not passed on: legacy widgets do not know it.
 * 6. **OpenID.** A legacy widget may always ask for a token (`get_openid`); the host hands one out
 *    only while the widget holds `widget:…get_openid`, which it grants for one token at a time.
 *    The bridge answers `get_openid` itself: while the capability is held it fetches the token at
 *    once (`state: "allowed"`). Otherwise it answers `state: "request"`, requests the capability
 *    once for every token request waiting, takes the host's next `update_capabilities` after the
 *    ack as the answer, and sends each waiting request `openid_credentials` (`allowed` with the
 *    token, or `blocked`). A host that takes capabilities away in between is read as a refusal.
 *
 * The class does no I/O. It is driven by `start`, `onIframeLoad`, `onWidgetMessage` and
 * `onHostMessage`, and sends through the callbacks in {@link BridgeOptions}.
 */
import { CurrentApiVersions } from "matrix-widget-api";

import { capabilitiesToRequest, collapseApproved, hostCapability, LEGACY_WEBVIEW_CAPABILITIES, normalizeCapability, widgetCapability } from "./capabilities";
import {
  ERROR_INVALID_REQUEST,
  ERROR_MISSING_CAPABILITY,
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
import { LEGACY_READ_EVENTS_ACTION, LegacyEventReader, NOTIFY_TIMELINE_UPDATE_ACTION } from "./readEvents";
import { templatedLegacyUrl } from "./url";
import { log } from "./log";

/** The context actions, in the unstable spelling the host emits (`docs/parity.md`). */
export const MATRIX_CONTEXT_ACTION = `${PLACEHOLDER}.get_matrix_context`;
export const CLIENT_CONTEXT_ACTION = `${PLACEHOLDER}.get_client_context`;
/** The capabilities for the context actions. */
export const CONTEXT_CAPABILITIES = [widgetCapability("get_matrix_context"), widgetCapability("get_client_context")];
/** What `start()` requests: the context capabilities and the webview capabilities of a legacy client's iframe. */
export const START_CAPABILITIES = [...CONTEXT_CAPABILITIES, ...LEGACY_WEBVIEW_CAPABILITIES];
/** The legacy widget's `get_openid`, which the bridge answers itself (see the module comment). */
const LEGACY_GET_OPENID = "get_openid";
/** The host's name of it, and its capability. */
export const GET_OPENID_ACTION = toNewAction(LEGACY_GET_OPENID, "widget");
export const GET_OPENID_CAPABILITY = widgetCapability("get_openid");
/** The host's `update_state`: the bridge keeps the state for legacy state reads. */
const UPDATE_STATE_ACTION = `${PLACEHOLDER}.update_state`;
/** The legacy host -> widget action with the outcome of a `get_openid` answered `state: "request"`. */
const LEGACY_OPENID_CREDENTIALS = "openid_credentials";

/** The `code` of an error body, if it is one. */
const errorCode = (body: unknown): unknown => (isErrorBody(body) ? (body as { error: { code?: unknown } }).error.code : undefined);

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
  /** How long a legacy timeline read may wait for paginations. Default: `LEGACY_READ_DEADLINE_MS`. */
  readDeadlineMs?: number;
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
  /** What the host's last `update_capabilities` allowed, normalised ({@link normalizeCapability}). */
  private held = new Set<string>();
  /** The widget's `get_openid` requests answered `state: "request"`: they get `openid_credentials`. */
  private openIdWaiting: LegacyMessage[] = [];
  /**
   * Where the token for {@link openIdWaiting} stands: the capability was requested (`sent`), the
   * host acknowledged that (`acked`: its next update is the answer), the token was requested
   * (`fetching`).
   */
  private openIdStep: "none" | "sent" | "acked" | "fetching" = "none";
  /** The widget's room, from `get_matrix_context`. */
  private roomId?: string;
  /** Answers the legacy `read_events` (readEvents.ts). */
  private readonly reader: LegacyEventReader;

  constructor(private readonly o: BridgeOptions) {
    this.reader = new LegacyEventReader({
      call: (action, request) => new Promise((resolve) => this.requestHost(action, request, resolve)),
      holdsUpdateState: (type) => {
        const capability = hostCapability(`update_state:${type}`);
        return [...this.held].some((held) => held === capability || held.startsWith(`${capability}#`));
      },
      roomId: () => this.roomId,
      deadlineMs: o.readDeadlineMs,
    });
  }

  /**
   * Start the bootstrap by requesting the context capabilities and the webview capabilities of a
   * legacy client ({@link START_CAPABILITIES}). The host answers with `update_capabilities`.
   */
  start(): void {
    this.requestHost(REQUEST_CAPABILITIES_ACTION, { capabilities: START_CAPABILITIES });
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
      if (typeof matrix.room_id === "string") this.roomId = matrix.room_id;
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
      case LEGACY_GET_OPENID:
        return this.onWidgetGetOpenId(m);
      case LEGACY_READ_EVENTS_ACTION:
        void this.reader.read(m.data).then((body) => this.o.sendToWidget(legacyResponse(m, body)));
        return;
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
    if (m.action === NOTIFY_TIMELINE_UPDATE_ACTION) {
      // Only for the bridge's own timeline reads; a legacy widget has no such action.
      this.o.sendToHost(newResponse(m, {}));
      return this.reader.onTimelineUpdate(m.request);
    }
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
      this.rememberAllowed(m.request);
      return this.bootstrap();
    }
    if (m.action === UPDATE_STATE_ACTION) this.reader.onUpdateState(m.request);
    this.fromHost.set(m.request_id, m);
    const request = m.action === UPDATE_CAPABILITIES_ACTION ? this.translateUpdate(m.request) : m.request;
    this.o.sendToWidget(newRequestToLegacy({ ...m, request }, this.o.widgetId));
    if (m.action === UPDATE_CAPABILITIES_ACTION && this.openIdStep === "acked") this.onOpenIdCapabilityAnswered();
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
    this.rememberAllowed(request);
    return { requested: this.legacyRequested, approved: collapseApproved([...this.legacyKnown], [...this.held]) };
  }

  /** Keep the `allowed` list of an `update_capabilities` body: what the widget holds from now on. */
  private rememberAllowed(request: unknown): void {
    const allowed = (request as { allowed?: unknown } | undefined)?.allowed;
    this.held = new Set((Array.isArray(allowed) ? allowed : []).filter((c): c is string => typeof c === "string").map(normalizeCapability));
  }

  // ---- OpenID --------------------------------------------------------------------------------

  /** The widget's `get_openid`: the token at once while the capability is held, else `state: "request"` and the capability is requested. */
  private onWidgetGetOpenId(m: LegacyMessage): void {
    if (this.openIdWaiting.length > 0 || !this.held.has(GET_OPENID_CAPABILITY)) return this.waitForOpenId(m);
    this.requestHost(GET_OPENID_ACTION, {}, (response) => {
      // The grant ended before the request arrived (a use whose update was still on its way): ask.
      if (errorCode(response) === ERROR_MISSING_CAPABILITY) return this.waitForOpenId(m);
      this.o.sendToWidget(legacyResponse(m, isErrorBody(response) ? response : { state: "allowed", ...(response as object) }));
    });
  }

  /** Answer `state: "request"` and request the capability, once for every waiting request. */
  private waitForOpenId(m: LegacyMessage): void {
    this.o.sendToWidget(legacyResponse(m, { state: "request" }));
    this.openIdWaiting.push(m);
    if (this.openIdStep !== "none") return;
    this.openIdStep = "sent";
    this.requestHost(REQUEST_CAPABILITIES_ACTION, { capabilities: [GET_OPENID_CAPABILITY] }, (response) => {
      if (isErrorBody(response)) return this.finishOpenId(undefined);
      this.openIdStep = "acked";
    });
  }

  /** The host's first `update_capabilities` after it acknowledged the capability request. */
  private onOpenIdCapabilityAnswered(): void {
    if (!this.held.has(GET_OPENID_CAPABILITY)) return this.finishOpenId(undefined);
    this.openIdStep = "fetching";
    this.requestHost(GET_OPENID_ACTION, {}, (response) => this.finishOpenId(isErrorBody(response) ? undefined : (response as object)));
  }

  /** Every waiting `get_openid` gets `openid_credentials`: `allowed` with the token, or `blocked`. */
  private finishOpenId(token: object | undefined): void {
    const waiting = this.openIdWaiting;
    this.openIdWaiting = [];
    this.openIdStep = "none";
    if (!token) log.warn(`no OpenID token for ${waiting.length} request(s) of the widget`);
    for (const request of waiting) {
      const data = token ? { state: "allowed", original_request_id: request.requestId, ...token } : { state: "blocked", original_request_id: request.requestId };
      this.requestWidget(LEGACY_OPENID_CREDENTIALS, data, () => {});
    }
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
