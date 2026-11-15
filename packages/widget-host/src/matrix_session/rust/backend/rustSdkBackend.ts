import {
  BackendError,
  RelationDirection,
  StateKeySelector,
  type JsonValue,
  type MatrixBackend,
  type MatrixEvent,
  type MediaConfigResponse,
  type MediaFile,
  type OpenIdToken,
  type RelationsChunk,
  type RoomAccountData,
  type RoomSink,
  type RoomSubjects,
  type SearchUserDirectoryResponse,
  type Subscription,
  type ToDeviceDelivery,
  type ToDeviceMessage,
  type ToDeviceSink,
  type TurnServerSink,
} from "@matrix-widget-tools/widget-host-bindings";
import { ClientError, DelayedEventUpdateAction, MediaSource, RtcTransport, stateEventTypeFromString, type ClientLike, type RoomLike } from "matrix-sdk-uniffi-js";

import { rawToMatrixEvent, stateToMatrixEvent } from "./events";
import { subscribeRoomFeed } from "./roomFeed";
import { subscribeTurnServers } from "./turnServer";

/** How many older events one `read_events` may make the SDK load while looking for matches. */
const READ_PAGE_SIZE = 100;
const READ_MAX_PAGES = 5;

/**
 * `MatrixBackend` for one room of a matrix-rust-sdk client (`matrix-sdk-uniffi-js`).
 *
 * Everything goes through the SDK, so sends are encrypted in encrypted rooms and what is read or
 * received is decrypted. Some of the calls are not upstream yet: they are this repository's
 * additions to the ffi (`packages/matrix-sdk-uniffi-js/sdk-additions`). The one exception is the
 * TURN servers, which the SDK has no call for (`turnServer.ts`).
 *
 * State is read from the SDK's store. That is complete for every state type only because the
 * session subscribes to the room with its full state before creating the backend.
 *
 * To-device messages are only sent encrypted; a widget asking for an unencrypted send gets an error.
 */
export class RustSdkBackend implements MatrixBackend {
  private readonly subscriptions = new Set<Subscription>();

  private constructor(
    private readonly client: ClientLike,
    private readonly room: RoomLike,
    private readonly profile: { displayName: string; avatarUrl: string },
  ) {}

  /** The trait's identity getters are synchronous, so the profile is fetched up front. */
  static async create(client: ClientLike, room: RoomLike): Promise<RustSdkBackend> {
    const [displayName, avatarUrl] = await Promise.all([
      client.displayName().catch(() => client.userId()),
      client.avatarUrl().catch(() => undefined),
    ]);
    return new RustSdkBackend(client, room, { displayName, avatarUrl: avatarUrl ?? "" });
  }

  // ---- Identity ----

  roomId = () => this.room.id();
  ownUserId = () => this.client.userId();
  ownDeviceId = () => this.client.deviceId();
  displayName = () => this.profile.displayName;
  avatarUrl = () => this.profile.avatarUrl;
  baseUrl = () => this.client.homeserver().replace(/\/+$/, "");

  // ---- Send half ----

  async sendRoomEvent(roomId: string, eventType: string, content: JsonValue): Promise<string> {
    return this.sdkRoom(roomId).sendRaw(eventType, JSON.stringify(content), undefined).catch(rethrow);
  }

  async sendStateEvent(roomId: string, eventType: string, stateKey: string, content: JsonValue): Promise<string> {
    return this.sdkRoom(roomId).sendStateEventRaw(eventType, stateKey, JSON.stringify(content), undefined).catch(rethrow);
  }

  async sendStickyEvent(roomId: string, eventType: string, content: JsonValue, durationMs: bigint): Promise<string> {
    return this.sdkRoom(roomId).sendStickyRaw(eventType, JSON.stringify(content), durationMs, undefined).catch(rethrow);
  }

  async sendDelayedEvent(roomId: string, eventType: string, stateKey: string | undefined, content: JsonValue, delayMs: bigint): Promise<string> {
    const room = this.sdkRoom(roomId);
    const json = JSON.stringify(content);
    const sent = stateKey === undefined ? room.sendDelayedEvent(eventType, json, delayMs, undefined) : room.sendDelayedStateEvent(eventType, stateKey, json, delayMs, undefined);
    return sent.catch(rethrow);
  }

  async sendDelayedStickyEvent(roomId: string, eventType: string, content: JsonValue, delayMs: bigint, durationMs: bigint): Promise<string> {
    return this.sdkRoom(roomId).sendStickyDelayedEvent(eventType, JSON.stringify(content), delayMs, durationMs, undefined).catch(rethrow);
  }

  restartDelayedEvent = (_roomId: string, delayId: string) => this.updateDelayedEvent(delayId, DelayedEventUpdateAction.Restart);
  cancelDelayedEvent = (_roomId: string, delayId: string) => this.updateDelayedEvent(delayId, DelayedEventUpdateAction.Cancel);
  sendDelayedEventNow = (_roomId: string, delayId: string) => this.updateDelayedEvent(delayId, DelayedEventUpdateAction.Send);

  async sendToDeviceMessage(encrypted: boolean, eventType: string, messages: ToDeviceMessage[]): Promise<ToDeviceDelivery[]> {
    // The SDK only sends to-device messages encrypted, and a widget has no good reason not to.
    if (!encrypted) throw fail("this host only sends encrypted to-device messages; set `encrypted: true`");
    // The SDK encrypts one content for a set of devices, so recipients are grouped by content.
    const recipientsByContent = new Map<string, Map<string, string[]>>();
    for (const { userId, deviceId, content } of messages) {
      const json = JSON.stringify(content);
      const recipients = recipientsByContent.get(json) ?? new Map<string, string[]>();
      recipientsByContent.set(json, recipients);
      recipients.set(userId, [...(recipients.get(userId) ?? []), deviceId]);
    }
    const failed = new Map<string, Set<string>>();
    for (const [json, recipients] of recipientsByContent) {
      const { failures } = await this.client.sendEncryptedToDeviceMessage(eventType, recipients, json).catch(rethrow);
      for (const [userId, deviceIds] of failures) failed.set(userId, new Set([...(failed.get(userId) ?? []), ...deviceIds]));
    }
    return messages.map(({ userId, deviceId }) => {
      const devices = failed.get(userId);
      // For `*` the SDK reports the devices it could not reach by their own ids.
      const undelivered = devices !== undefined && (deviceId === "*" || devices.has(deviceId));
      return { userId, deviceId, error: undelivered ? "the message could not be encrypted for this device" : undefined };
    });
  }

  // ---- Read half ----

  /**
   * The newest `limit` events of a type, oldest first, from the SDK's event cache. If the cache
   * holds too few, older events are loaded, up to a bound: a rare type is not searched for through
   * the whole history of the room.
   */
  async readRoomEvents(roomId: string, eventType: string, msgtype: string | undefined, limit: number, _since: string | undefined): Promise<MatrixEvent[]> {
    const room = this.sdkRoom(roomId);
    const matching = async () =>
      (await room.eventsRaw().catch(rethrow))
        .map((json) => rawToMatrixEvent(json, roomId))
        .filter((ev) => ev.eventType === eventType && (msgtype === undefined || (ev.content as { msgtype?: unknown } | undefined)?.msgtype === msgtype));

    let events = await matching();
    for (let page = 0; events.length < limit && page < READ_MAX_PAGES; page++) {
      const reachedStart = await room.paginateEventsRawBackwards(READ_PAGE_SIZE).catch(rethrow);
      events = await matching();
      if (reachedStart) break;
    }
    return events.slice(-limit);
  }

  async readRoomState(roomId: string, eventType: string, stateKey: StateKeySelector): Promise<MatrixEvent[]> {
    const key = StateKeySelector.Key.instanceOf(stateKey) ? stateKey.inner.key : undefined;
    const state = await this.sdkRoom(roomId).stateEvents(stateEventTypeFromString(eventType)).catch(rethrow);
    return state.filter((ev) => key === undefined || ev.stateKey === key).map((ev) => stateToMatrixEvent(ev, eventType, roomId));
  }

  /** `to` is not passed on: the SDK pages with `from` only. */
  async relations(
    roomId: string,
    eventId: string,
    relType: string | undefined,
    eventType: string | undefined,
    from: string | undefined,
    _to: string | undefined,
    limit: number | undefined,
    direction: RelationDirection | undefined,
  ): Promise<RelationsChunk> {
    const forward = direction === RelationDirection.Forward;
    const page = await this.sdkRoom(roomId).relationsRaw(eventId, relType, eventType, from, limit, forward).catch(rethrow);
    return { chunk: page.events.map((json) => rawToMatrixEvent(json, roomId)), nextBatch: page.nextBatchToken, prevBatch: page.prevBatchToken };
  }

  async openidToken(): Promise<OpenIdToken> {
    const token = await this.client.requestOpenidToken().catch(rethrow);
    return { accessToken: token.accessToken, tokenType: token.tokenType, matrixServerName: token.matrixServerName, expiresIn: token.expiresInSeconds };
  }

  async rtcTransports(): Promise<JsonValue> {
    const transports = (await this.client.discoverRtcTransports().catch(rethrow)) ?? [];
    // The SDK parses the transports; this is the `rtc_transports` JSON they were parsed from. It
    // does not say whether a LiveKit transport used the `m.livekit` or the legacy `livekit` type:
    // a transport with a `url` is reported as `m.livekit`.
    return transports.map((transport) => {
      if (RtcTransport.LiveKit.instanceOf(transport)) {
        const { url, serviceUrl } = transport.inner;
        return { type: url === undefined ? "livekit" : "m.livekit", url, livekit_service_url: serviceUrl };
      }
      return { ...(JSON.parse(transport.inner.data) as Record<string, unknown>), type: transport.inner.transportType };
    });
  }

  async searchUserDirectory(searchTerm: string, limit: number | undefined): Promise<SearchUserDirectoryResponse> {
    const { results, limited } = await this.client.searchUsers(searchTerm, BigInt(limit ?? 10)).catch(rethrow);
    return { limited, results: results.map(({ userId, displayName, avatarUrl }) => ({ userId, displayName, avatarUrl })) };
  }

  async mediaConfig(): Promise<MediaConfigResponse> {
    return { uploadSize: await this.client.getMaxMediaUploadSize().catch(rethrow) };
  }

  async uploadMedia(file: MediaFile): Promise<string> {
    return this.client.uploadMedia(file.mimetype ?? "application/octet-stream", file.data, undefined).catch(rethrow);
  }

  /** The SDK returns the bytes only, so the content type stays unknown. */
  async downloadMedia(contentUri: string): Promise<MediaFile> {
    try {
      return { data: await this.client.getMediaContent(MediaSource.fromUrl(contentUri)), mimetype: undefined };
    } catch (e) {
      rethrow(e);
    }
  }

  async readRoomAccountData(roomId: string, eventType: string): Promise<RoomAccountData[]> {
    const json = await this.sdkRoom(roomId).accountDataRaw(eventType).catch(rethrow);
    if (json === undefined) return [];
    return [{ eventType, roomId, content: (JSON.parse(json) as { content: JsonValue }).content }];
  }

  async rtcLivekitGetToken(serverName: string, url: string, roomId: string, slotId: string, memberId: string): Promise<string> {
    return this.client.rtcLivekitGetToken(url, roomId, slotId, memberId, serverName || undefined).catch(rethrow);
  }

  async rtcLivekitDelegateDelayedLeave(url: string, roomId: string, slotId: string, memberId: string, delayId: string): Promise<void> {
    return this.client.rtcLivekitDelegateDelayedLeave(url, roomId, slotId, memberId, delayId).catch(rethrow);
  }

  // ---- Subscriptions ----

  subscribeRoom(roomId: string, subjects: RoomSubjects, sink: RoomSink): Subscription {
    return this.track(subscribeRoomFeed(this.sdkRoom(roomId), subjects, sink));
  }

  subscribeToDevice(eventTypes: string[], sink: ToDeviceSink): Subscription {
    const handle = this.client.subscribeToCustomToDeviceMessages(eventTypes, {
      onMessage: ({ eventType, senderId, content, encryptionInfo }) =>
        sink.onToDeviceMessage({ eventType, sender: senderId, content: JSON.parse(content), encrypted: encryptionInfo !== undefined }),
    });
    return this.track({ cancel: () => handle.cancel() });
  }

  subscribeTurnServers(sink: TurnServerSink): Subscription {
    return this.track(subscribeTurnServers(this.client, sink));
  }

  /** End every subscription still running; call when the room view goes away. */
  dispose(): void {
    for (const subscription of [...this.subscriptions]) subscription.cancel();
  }

  // ---- Helpers ----

  private sdkRoom(roomId: string): RoomLike {
    if (roomId === this.room.id()) return this.room;
    const room = this.client.getRoom(roomId);
    if (!room) throw fail(`unknown room ${roomId}`);
    return room;
  }

  /** Remember a subscription until it is cancelled, so that `dispose` can end the ones left. */
  private track(subscription: Subscription): Subscription {
    const tracked: Subscription = {
      cancel: () => {
        this.subscriptions.delete(tracked);
        subscription.cancel();
      },
    };
    this.subscriptions.add(tracked);
    return tracked;
  }

  private updateDelayedEvent(delayId: string, action: DelayedEventUpdateAction): Promise<void> {
    return this.client.updateDelayedEvent(delayId, action, undefined).catch(rethrow);
  }
}

const fail = (reason: string) => new BackendError.Failed({ errcode: undefined, status: undefined, reason });

/**
 * SDK errors are not `BackendError`s; wrap them so the driver can report them to the widget. The
 * SDK passes on the homeserver's error code but not the HTTP status.
 */
function rethrow(e: unknown): never {
  if (ClientError.MatrixApi.instanceOf(e)) throw new BackendError.Failed({ errcode: e.inner.code, status: undefined, reason: e.inner.msg });
  if (ClientError.Generic.instanceOf(e)) throw fail(e.inner.msg);
  throw fail(e instanceof Error ? e.message : String(e));
}
