import {
  BackendError,
  RelationDirection,
  type JsonValue,
  type MatrixBackend,
  type MatrixEvent,
  type MediaConfigResponse,
  type MediaFile,
  type OpenIdToken,
  type PaginationStatus,
  type RelationsChunk,
  type RoomAccountData,
  type RoomSink,
  type RoomSubjects,
  type SearchUserDirectoryResponse,
  type Subscription,
  type TimelineChunk,
  type TimelineFilter,
  type TimelineSink,
  type ToDeviceDelivery,
  type ToDeviceMessage,
  type ToDeviceSink,
  type TurnServerSink,
} from "@matrix-widget-tools/widget-host-bindings";
import { ClientError, DelayedEventUpdateAction, MediaSource, RtcTransport, type ClientLike, type RoomLike } from "matrix-sdk-uniffi-js";

import { RoomTimelines } from "../../roomTimelines";
import { TimelineFeed, walkCache, type CachedEvent } from "../../timelineFeed";
import { onTimelineChanged } from "../roomData";
import { rawToMatrixEvent } from "./events";
import { subscribeRoomFeed } from "./roomFeed";
import { subscribeTurnServers } from "./turnServer";

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
 * The timeline cache of `read_timeline` is the room's event cache (`eventsRaw`); its pagination is
 * the session's `RoomTimelines`, shared with the RoomTimeline and the room's other widgets. Resets
 * and late decryptions come from `subscribeToTimelineChangesRaw` (an addition to the ffi).
 *
 * To-device messages are only sent encrypted; a widget asking for an unencrypted send gets an error.
 */
export class RustSdkBackend implements MatrixBackend {
  private readonly subscriptions = new Set<Subscription>();
  private readonly feed: TimelineFeed;

  private constructor(
    private readonly client: ClientLike,
    private readonly room: RoomLike,
    private readonly profile: { displayName: string; avatarUrl: string },
    timelines: RoomTimelines,
  ) {
    const roomId = room.id();
    this.feed = new TimelineFeed(timelines, roomId, {
      paginate: (count) => room.paginateEventsRawBackwards(count).catch(rethrow),
      watchDecrypted: (report) => {
        const handle = room.subscribeToTimelineChangesRaw({
          onReset: () => undefined,
          // The redactions the event cache applies in place are not decryptions.
          onDecrypted: (events) => report(events.map((json) => rawToMatrixEvent(json, roomId)).filter((ev) => !isRedacted(ev.unsigned))),
        });
        return () => handle.cancel();
      },
    });
  }

  /**
   * The trait's identity getters are synchronous, so the profile is fetched up front. `timelines`
   * is the session's (paginations are shared); without it the backend keeps its own.
   */
  static async create(client: ClientLike, room: RoomLike, timelines?: RoomTimelines): Promise<RustSdkBackend> {
    const [displayName, avatarUrl] = await Promise.all([
      client.displayName().catch(() => client.userId()),
      client.avatarUrl().catch(() => undefined),
    ]);
    const ownTimelines = timelines ?? new RoomTimelines((_roomId, changed) => onTimelineChanged(room, changed));
    return new RustSdkBackend(client, room, { displayName, avatarUrl: avatarUrl ?? "" }, ownTimelines);
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

  /** The event cache, newest first; events it could not decrypt (`m.room.encrypted`) are skipped. */
  async timelineRead(roomId: string, from: string | undefined, limit: number, filter: TimelineFilter[]): Promise<TimelineChunk> {
    const cached = await this.cachedEvents(roomId);
    return { events: walkCache(cached, from, limit, filter), pagination: this.feed.status(cached[0]?.eventType) };
  }

  async timelinePaginateBackwards(roomId: string, limit: number | undefined): Promise<PaginationStatus> {
    const cached = await this.cachedEvents(roomId);
    return this.feed.paginate(limit, cached[0]?.eventType);
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

  subscribeTimeline(roomId: string, sink: TimelineSink): Subscription {
    this.sdkRoom(roomId);
    return this.track(this.feed.subscribe(sink));
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

  private async cachedEvents(roomId: string): Promise<CachedEvent[]> {
    const raw = await this.sdkRoom(roomId).eventsRaw().catch(rethrow);
    return raw.map((json) => {
      const { event_id: eventId, type, content } = JSON.parse(json) as { event_id?: string; type?: string; content?: { msgtype?: unknown } };
      return {
        eventId: eventId ?? "",
        eventType: type === "m.room.encrypted" ? undefined : type,
        msgtype: content?.msgtype,
        toEvent: () => rawToMatrixEvent(json, roomId),
      };
    });
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

const isRedacted = (unsigned: JsonValue | undefined) => typeof unsigned === "object" && unsigned !== null && "redacted_because" in unsigned;

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
