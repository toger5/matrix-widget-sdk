/**
 * The protocol bridge: legacy widget on one side, MSC4412 host on the other.
 *
 * Everything is forwarded 1:1 (see envelope.ts) except two things the wrapper does itself:
 *
 * 1. **Bootstrap**: before the legacy widget can be loaded its URL has to be templated. The
 *    wrapper requests the `matrix_context` / `client_context` capabilities, asks the host
 *    for both contexts, renders the URL (template.ts) and only then loads the inner iframe.
 *    A missing capability or an unsupported action just leaves the variables empty.
 * 2. **Startup handshake**: legacy capabilities are host-initiated (`toWidget capabilities`),
 *    MSC4412 capabilities are widget-initiated (`request_capabilities`); a legacy host starts
 *    that round on the iframe `load` event (waitForIframeLoad=true) or on the widget's
 *    `content_loaded` (waitForIframeLoad=false); and the legacy widget asks
 *    `supported_api_versions`, which an MSC4412 host does not know.
 *
 * This class is transport free: it is driven by `start`, `onIframeLoad`, `onWidgetMessage`
 * and `onHostMessage` and talks back through the callbacks in `BridgeOptions`.
 */
import { CurrentApiVersions } from "matrix-widget-api";

import {
  API_VERSION,
  errorBody,
  isLegacyMessage,
  isNewMessage,
  legacyRequestToNew,
  legacyResponse,
  newRequestToLegacy,
  newResponse,
  type LegacyMessage,
  type NewMessage,
} from "./envelope";
import { renderLegacyUrl, type ClientContext, type MatrixContext } from "./template";

/** Unstable spellings, as the host emits them (`docs/parity.md`). */
export const MATRIX_CONTEXT_ACTION = "org.matrix.msc4412.matrix_context";
export const CLIENT_CONTEXT_ACTION = "org.matrix.msc4412.client_context";
export const CONTEXT_CAPABILITIES = [MATRIX_CONTEXT_ACTION, CLIENT_CONTEXT_ACTION];

export interface BridgeOptions {
  /** `widgetId` the legacy widget expects on every message (the legacy state event's `state_key`). */
  widgetId: string;
  /** The legacy widget's `waitForIframeLoad` setting (legacy default: true). */
  waitForIframeLoad: boolean;
  /** The untemplated legacy widget URL (`content.url` of the legacy state event). */
  legacyWidgetUrl: string;
  /** `content.data` of the legacy state event: extra `$key` template variables. */
  widgetData?: Record<string, unknown>;
  /** URL of the wrapper page, handed to the legacy widget as `parentUrl`. */
  wrapperUrl: string;
  sendToHost(message: NewMessage): void;
  sendToWidget(message: LegacyMessage): void;
  /** Load the (templated) legacy widget URL in the inner iframe. Called exactly once. */
  loadWidget(url: string): void;
  /** Versions announced to the widget. Default: matrix-widget-api's `CurrentApiVersions`. */
  supportedVersions?: string[];
  /** Request id generator for the bridge's own requests. Default: `crypto.randomUUID`. */
  nextId?: () => string;
}

type Responder = (response: unknown) => void;
const isError = (response: unknown): boolean =>
  typeof response === "object" && response !== null && "error" in response;

export class CompatBridge {
  /** Legacy requests forwarded to the host, kept to build the echoed legacy response. */
  private readonly fromWidget = new Map<string, LegacyMessage>();
  /** Host requests forwarded to the widget, kept to build the MSC4412 response header. */
  private readonly fromHost = new Map<string, NewMessage>();
  /** Requests the bridge itself sent (either direction). */
  private readonly own = new Map<string, Responder>();
  private phase: "bootstrap" | "running" = "bootstrap";
  private contentLoadedSentToHost = false;
  private contentLoadedSeen = false;

  constructor(private readonly o: BridgeOptions) {}

  /** Begin: ask for the context capabilities. The host answers with `notify_capabilities`. */
  start(): void {
    this.requestHost("request_capabilities", { capabilities: CONTEXT_CAPABILITIES });
  }

  /** The inner iframe fired `load` (also on reloads). */
  onIframeLoad(): void {
    this.contentLoadedSeen = false;
    if (this.o.waitForIframeLoad) {
      this.sendContentLoadedOnce();
      this.negotiateCapabilities();
    }
  }

  /** `event.data` of a message whose source is the inner iframe. */
  onWidgetMessage(data: unknown): void {
    if (!isLegacyMessage(data) || data.widgetId !== this.o.widgetId) return;
    if (data.response !== undefined) return this.onWidgetResponse(data);
    if (data.api === "fromWidget") this.onWidgetRequest(data);
  }

  /** `event.data` of a message whose source is the parent window. */
  onHostMessage(data: unknown): void {
    if (!isNewMessage(data)) return;
    if (data.response !== undefined) return this.onHostResponse(data);
    if (data.source === "host") this.onHostRequest(data);
  }

  // ---- bootstrap -----------------------------------------------------------------------------

  /** First `notify_capabilities`: fetch both contexts, template the URL, load the widget. */
  private bootstrap(): void {
    const matrix: Partial<MatrixContext> = {};
    const client: ClientContext = {};
    let pending = 2;
    const done = () => {
      if (--pending > 0) return;
      this.phase = "running";
      this.o.loadWidget(
        renderLegacyUrl(this.o.legacyWidgetUrl, {
          widgetId: this.o.widgetId,
          wrapperUrl: this.o.wrapperUrl,
          matrix,
          client,
          data: this.o.widgetData,
        }),
      );
    };
    // Errors (capability denied, action unknown to the host) leave the variables empty.
    this.requestHost(MATRIX_CONTEXT_ACTION, {}, (r) => (isError(r) || Object.assign(matrix, r), done()));
    this.requestHost(CLIENT_CONTEXT_ACTION, {}, (r) => (isError(r) || Object.assign(client, r), done()));
  }

  // ---- widget -> host ------------------------------------------------------------------------

  private onWidgetRequest(m: LegacyMessage): void {
    switch (m.action) {
      case "supported_api_versions":
        // Answered locally: the widget asks this during start() and again while handling
        // `capabilities`; an MSC4412 host would answer "unknown action".
        return this.o.sendToWidget(
          legacyResponse(m, { supported_versions: this.o.supportedVersions ?? CurrentApiVersions }),
        );
      case "content_loaded":
        return this.onWidgetContentLoaded(m);
      default:
        this.fromWidget.set(m.requestId, m);
        this.o.sendToHost(legacyRequestToNew(m));
    }
  }

  private onWidgetContentLoaded(m: LegacyMessage): void {
    if (this.contentLoadedSeen) {
      return this.o.sendToWidget(
        legacyResponse(m, errorBody("Improper sequence: ContentLoaded Action can only be sent once")),
      );
    }
    this.contentLoadedSeen = true;
    if (this.o.waitForIframeLoad) {
      // Exact legacy behaviour: with waitForIframeLoad the host does not expect content_loaded.
      return this.o.sendToWidget(legacyResponse(m, errorBody("Improper sequence: not expecting ContentLoaded event")));
    }
    this.o.sendToWidget(legacyResponse(m, {}));
    this.sendContentLoadedOnce();
    this.negotiateCapabilities();
  }

  private onHostResponse(m: NewMessage): void {
    const own = this.own.get(m.requestId);
    if (own) {
      this.own.delete(m.requestId);
      return own(m.response);
    }
    const request = this.fromWidget.get(m.requestId);
    if (!request) return;
    this.fromWidget.delete(m.requestId);
    this.o.sendToWidget(legacyResponse(request, m.response));
  }

  // ---- host -> widget ------------------------------------------------------------------------

  private onHostRequest(m: NewMessage): void {
    if (m.version !== API_VERSION) {
      return this.o.sendToHost(newResponse(m, errorBody(`Unsupported widget api version \`${m.version}\``)));
    }
    if (this.phase === "bootstrap") {
      // The only host request expected now is the answer to our own capability request.
      if (m.action !== "notify_capabilities") {
        return this.o.sendToHost(newResponse(m, errorBody("The wrapped widget is not loaded yet")));
      }
      this.o.sendToHost(newResponse(m, {}));
      return this.bootstrap();
    }
    this.fromHost.set(m.requestId, m);
    this.o.sendToWidget(newRequestToLegacy(m, this.o.widgetId));
  }

  private onWidgetResponse(m: LegacyMessage): void {
    const own = this.own.get(m.requestId);
    if (own) {
      this.own.delete(m.requestId);
      return own(m.response);
    }
    const request = this.fromHost.get(m.requestId);
    if (!request) return;
    this.fromHost.delete(m.requestId);
    this.o.sendToHost(newResponse(request, m.response));
  }

  // ---- handshake -----------------------------------------------------------------------------

  /** Tell the host once that the widget may be shown (the moment a legacy host would show it). */
  private sendContentLoadedOnce(): void {
    if (this.contentLoadedSentToHost) return;
    this.contentLoadedSentToHost = true;
    this.requestHost("content_loaded", {});
  }

  /** Legacy host round: ask the widget for its capabilities, request them from the real host. */
  private negotiateCapabilities(): void {
    this.requestWidget("capabilities", {}, (response) => {
      const capabilities = (response as { capabilities?: string[] } | undefined)?.capabilities ?? [];
      this.requestHost("request_capabilities", { capabilities });
    });
  }

  private requestHost(action: string, request: unknown, onResponse: Responder = () => {}): void {
    const requestId = this.nextId();
    this.own.set(requestId, onResponse);
    this.o.sendToHost({ source: "widget", version: API_VERSION, requestId, action, request });
  }

  private requestWidget(action: string, data: unknown, onResponse: Responder): void {
    const requestId = this.nextId();
    this.own.set(requestId, onResponse);
    this.o.sendToWidget({ api: "toWidget", widgetId: this.o.widgetId, requestId, action, data });
  }

  private nextId(): string {
    return this.o.nextId ? this.o.nextId() : crypto.randomUUID();
  }
}
