import {
  BackendError,
  matrixEventFromJson,
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
} from "@matrix-widget-sdk/host";
import {
  ClientEvent,
  Direction,
  MatrixError,
  MatrixEventEvent,
  RoomStateEvent,
  type ITurnServer,
  type MatrixClient,
  type MatrixEvent as SdkEvent,
  type Room,
  type SendToDeviceContentMap,
} from "matrix-js-sdk";

import { RoomTimelines } from "../../roomTimelines";
import { TimelineFeed, walkCache, type CachedEvent } from "../../timelineFeed";
import { loadOlderEvents, onTimelineChanged } from "../roomData";

/**
 * `MatrixBackend` for one room of a matrix-js-sdk client. Sends go through the SDK (encrypted in
 * encrypted rooms), reads come from its local copy of the room, subscriptions listen to its sync.
 * The timeline cache of `read_timeline` is the room's live timeline (`../../timelineFeed`).
 */
export class JsSdkBackend implements MatrixBackend {
  private readonly subscriptions = new Set<() => void>();
  private readonly feed: TimelineFeed;

  private constructor(
    private readonly client: MatrixClient,
    private readonly boundRoomId: string,
    private readonly profile: { displayName: string; avatarUrl: string },
    timelines: RoomTimelines,
  ) {
    this.feed = new TimelineFeed(timelines, boundRoomId, {
      paginate: (count) => loadOlderEvents(client, boundRoomId, count),
      watchDecrypted: (report) => this.watchDecrypted(report),
    });
  }

  /** The identity getters are synchronous: the profile is fetched up front. Without the session's `timelines` the backend keeps its own. */
  static async create(client: MatrixClient, roomId: string, timelines?: RoomTimelines): Promise<JsSdkBackend> {
    const userId = client.getSafeUserId();
    const profile = await client.getProfileInfo(userId).catch(() => undefined);
    const ownTimelines = timelines ?? new RoomTimelines((id, changed) => onTimelineChanged(client, id, changed));
    return new JsSdkBackend(client, roomId, { displayName: profile?.displayname ?? userId, avatarUrl: profile?.avatar_url ?? "" }, ownTimelines);
  }

  // ---- Identity ----

  roomId = () => this.boundRoomId;
  ownUserId = () => this.client.getSafeUserId();
  ownDeviceId = () => this.client.getDeviceId() ?? "";
  displayName = () => this.profile.displayName;
  avatarUrl = () => this.profile.avatarUrl;
  baseUrl = () => this.client.getHomeserverUrl();

  // ---- Send half ----

  async sendRoomEvent(roomId: string, eventType: string, content: JsonValue): Promise<string> {
    return (await wrap(this.client.sendEvent(roomId, eventType as never, content as never))).event_id;
  }

  async redactEvent(roomId: string, eventId: string, reason: string | undefined): Promise<string> {
    return (await wrap(this.client.redactEvent(roomId, eventId, undefined, { reason }))).event_id;
  }

  async sendStateEvent(roomId: string, eventType: string, stateKey: string, content: JsonValue): Promise<string> {
    return (await wrap(this.client.sendStateEvent(roomId, eventType as never, content as never, stateKey))).event_id;
  }

  async sendStickyEvent(roomId: string, eventType: string, content: JsonValue, durationMs: bigint): Promise<string> {
    return (await wrap(this.client._unstable_sendStickyEvent(roomId, Number(durationMs), null, eventType as never, content as never))).event_id;
  }

  async sendDelayedEvent(roomId: string, eventType: string, stateKey: string | undefined, content: JsonValue, delayMs: bigint): Promise<string> {
    const delay = { delay: Number(delayMs) };
    const response =
      stateKey === undefined
        ? this.client._unstable_sendDelayedEvent(roomId, delay, null, eventType as never, content as never)
        : this.client._unstable_sendDelayedStateEvent(roomId, delay, eventType as never, content as never, stateKey);
    return (await wrap(response)).delay_id;
  }

  async sendDelayedStickyEvent(roomId: string, eventType: string, content: JsonValue, delayMs: bigint, durationMs: bigint): Promise<string> {
    const response = this.client._unstable_sendStickyDelayedEvent(roomId, Number(durationMs), { delay: Number(delayMs) }, null, eventType as never, content as never);
    return (await wrap(response)).delay_id;
  }

  async restartDelayedEvent(_roomId: string, delayId: string): Promise<void> {
    await wrap(this.client._unstable_restartScheduledDelayedEvent(delayId));
  }

  async cancelDelayedEvent(_roomId: string, delayId: string): Promise<void> {
    await wrap(this.client._unstable_cancelScheduledDelayedEvent(delayId));
  }

  async sendDelayedEventNow(_roomId: string, delayId: string): Promise<void> {
    await wrap(this.client._unstable_sendScheduledDelayedEvent(delayId));
  }

  async sendToDeviceMessage(encrypted: boolean, eventType: string, messages: ToDeviceMessage[]): Promise<ToDeviceDelivery[]> {
    if (!encrypted) {
      // The homeserver expands `*` to every device of the user itself.
      const contentMap: SendToDeviceContentMap = new Map();
      for (const { userId, deviceId, content } of messages) {
        if (!contentMap.has(userId)) contentMap.set(userId, new Map());
        contentMap.get(userId)!.set(deviceId, content as Record<string, unknown>);
      }
      await wrap(this.client.sendToDevice(eventType, contentMap));
      return messages.map(({ userId, deviceId }) => ({ userId, deviceId, error: undefined }));
    }

    const crypto = this.client.getCrypto();
    if (!crypto) throw fail("end-to-end encryption is not set up in this client");
    // Encryption is per device, so `*` is expanded here.
    const wildcardUsers = [...new Set(messages.filter((m) => m.deviceId === "*").map((m) => m.userId))];
    const known = wildcardUsers.length > 0 ? await wrap(crypto.getUserDeviceInfo(wildcardUsers, true)) : new Map();
    // `encryptToDeviceMessages` takes one payload for many devices: group the recipients by content.
    const groups = new Map<string, { content: JsonValue; devices: { userId: string; deviceId: string }[] }>();
    for (const { userId, deviceId, content } of messages) {
      const deviceIds = deviceId === "*" ? [...(known.get(userId)?.keys() ?? [])] : [deviceId];
      const key = JSON.stringify(content);
      if (!groups.has(key)) groups.set(key, { content, devices: [] });
      groups.get(key)!.devices.push(...deviceIds.map((id) => ({ userId, deviceId: id })));
    }

    const deliveries: ToDeviceDelivery[] = [];
    for (const { content, devices } of groups.values()) {
      const batch = await wrap(crypto.encryptToDeviceMessages(eventType, devices, content as Record<string, unknown>));
      await wrap(this.client.queueToDevice(batch));
      // Devices the SDK could not encrypt for (no Olm session, unknown device) are left out of the batch.
      const encryptedFor = new Set(batch.batch.map((m) => `${m.userId} ${m.deviceId}`));
      for (const { userId, deviceId } of devices) {
        const sent = encryptedFor.has(`${userId} ${deviceId}`);
        deliveries.push({ userId, deviceId, error: sent ? undefined : "the message could not be encrypted for this device" });
      }
    }
    return deliveries;
  }

  // ---- Read half ----

  /**
   * The live timeline is the cache: no local echoes of what is still being sent, and events the
   * SDK could not decrypt are skipped (they still count as cached for `from`).
   */
  async timelineRead(roomId: string, from: string | undefined, limit: number, filter: TimelineFilter[]): Promise<TimelineChunk> {
    const events = this.cachedEvents(roomId);
    const cache: CachedEvent[] = events.map((ev) => {
      const readable = isReadable(ev);
      return {
        eventId: ev.getId() ?? "",
        eventType: readable ? ev.getType() : undefined,
        msgtype: readable ? ev.getContent().msgtype : undefined,
        toEvent: () => toMatrixEvent(ev, roomId),
      };
    });
    return { events: walkCache(cache, from, limit, filter), pagination: this.feed.status(events[0]?.getType()) };
  }

  async timelinePaginateBackwards(roomId: string, limit: number | undefined): Promise<PaginationStatus> {
    return this.feed.paginate(limit, this.cachedEvents(roomId)[0]?.getType());
  }

  async relations(
    roomId: string,
    eventId: string,
    relType: string | undefined,
    eventType: string | undefined,
    from: string | undefined,
    to: string | undefined,
    limit: number | undefined,
    direction: RelationDirection | undefined,
  ): Promise<RelationsChunk> {
    const dir = direction === undefined ? undefined : direction === RelationDirection.Forward ? Direction.Forward : Direction.Backward;
    const response = await wrap(this.client.relations(roomId, eventId, relType ?? null, eventType ?? null, { from, to, limit, dir }));
    return {
      chunk: response.events.filter(isReadable).map((ev) => toMatrixEvent(ev, roomId)),
      nextBatch: response.nextBatch ?? undefined,
      prevBatch: response.prevBatch ?? undefined,
    };
  }

  async openidToken(): Promise<OpenIdToken> {
    const token = await wrap(this.client.getOpenIdToken());
    return { accessToken: token.access_token, tokenType: token.token_type, matrixServerName: token.matrix_server_name, expiresIn: BigInt(token.expires_in) };
  }

  async rtcTransports(): Promise<JsonValue> {
    try {
      return (await this.client._unstable_getRTCTransports()) as unknown as JsonValue;
    } catch (e) {
      if (isUnsupported(e)) return [];
      throw toBackendError(e);
    }
  }

  async searchUserDirectory(searchTerm: string, limit: number | undefined): Promise<SearchUserDirectoryResponse> {
    const { limited, results } = await wrap(this.client.searchUserDirectory({ term: searchTerm, limit }));
    return { limited, results: results.map((user) => ({ userId: user.user_id, displayName: user.display_name, avatarUrl: user.avatar_url })) };
  }

  async mediaConfig(): Promise<MediaConfigResponse> {
    const size = (await wrap(this.client.getMediaConfig(true)))["m.upload.size"];
    return { uploadSize: typeof size === "number" ? BigInt(size) : undefined };
  }

  async uploadMedia(file: MediaFile): Promise<string> {
    const type = file.mimetype ?? "application/octet-stream";
    return (await wrap(this.client.uploadContent(new Blob([file.data], { type }), { type }))).content_uri;
  }

  /** Authenticated media: the download URL from the SDK, fetched with the session's access token. */
  async downloadMedia(contentUri: string): Promise<MediaFile> {
    const url = this.client.mxcUrlToHttp(contentUri, undefined, undefined, undefined, false, true, true);
    if (!url) throw fail(`not an mxc:// URI: ${contentUri}`);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${this.client.getAccessToken() ?? ""}` } }).catch((e: unknown) => {
      throw toBackendError(e);
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { errcode?: string; error?: string };
      throw new BackendError.Failed({ errcode: body.errcode, status: response.status, reason: body.error ?? `downloading ${contentUri} failed with status ${response.status}` });
    }
    return { data: await response.arrayBuffer(), mimetype: response.headers.get("Content-Type") ?? undefined };
  }

  async readRoomAccountData(roomId: string, eventType: string): Promise<RoomAccountData[]> {
    const event = this.room(roomId).getAccountData(eventType);
    return event ? [{ eventType, roomId, content: event.getContent() as JsonValue }] : [];
  }

  async rtcLivekitGetToken(serverName: string, url: string, roomId: string, slotId: string, memberId: string): Promise<string> {
    const request = { url, room_id: roomId, slot_id: slotId, member_id: memberId, server_name: serverName };
    return (await wrap(this.client._unstable_getLivekitToken(request))).jwt;
  }

  async rtcLivekitDelegateDelayedLeave(url: string, roomId: string, slotId: string, memberId: string, delayId: string): Promise<void> {
    await wrap(this.client._unstable_delegateDelayedLeave({ url, room_id: roomId, slot_id: slotId, member_id: memberId, delay_id: delayId }));
  }

  // ---- Subscriptions ----

  /**
   * Timeline events as the sync delivers them (encrypted ones once they are decrypted), and for
   * every subscribed state event type its complete current set: once now, then on every change.
   */
  subscribeRoom(roomId: string, subjects: RoomSubjects, sink: RoomSink): Subscription {
    const room = this.room(roomId);
    const timelineTypes = new Set(subjects.timelineEventTypes);
    const stateTypes = new Set(subjects.stateEventTypes);

    const onTimeline = (event: SdkEvent) => {
      if (event.getRoomId() !== roomId || !isReadable(event) || !timelineTypes.has(event.getType())) return;
      sink.onTimelineEvents([toMatrixEvent(event, roomId)]);
    };
    const pushState = (eventType: string) =>
      sink.onStateEvents(
        eventType,
        room.currentState.getStateEvents(eventType).map((ev) => toMatrixEvent(ev, roomId)),
      );
    const onState = (event: SdkEvent) => {
      if (event.getRoomId() === roomId && stateTypes.has(event.getType())) pushState(event.getType());
    };

    if (timelineTypes.size > 0) {
      this.client.on(ClientEvent.Event, onTimeline);
      this.client.on(MatrixEventEvent.Decrypted, onTimeline);
    }
    if (stateTypes.size > 0) this.client.on(RoomStateEvent.Events, onState);
    const subscription = this.track(() => {
      this.client.off(ClientEvent.Event, onTimeline);
      this.client.off(MatrixEventEvent.Decrypted, onTimeline);
      this.client.off(RoomStateEvent.Events, onState);
    });
    // The driver subscribes from inside one of its own methods; deliver the current state after it returned.
    queueMicrotask(() => {
      if (subscription.active()) stateTypes.forEach(pushState);
    });
    return subscription;
  }

  /** Pagination status changes, gaps of the sync (`RoomEvent.TimelineReset`) and late decryptions. */
  subscribeTimeline(roomId: string, sink: TimelineSink): Subscription {
    this.room(roomId);
    const subscription = this.feed.subscribe(sink);
    return this.track(() => subscription.cancel());
  }

  subscribeToDevice(eventTypes: string[], sink: ToDeviceSink): Subscription {
    const types = new Set(eventTypes);
    const onMessage = ({ message, encryptionInfo }: { message: { type: string; sender: string; content: unknown }; encryptionInfo: unknown }) => {
      if (!types.has(message.type)) return;
      sink.onToDeviceMessage({ eventType: message.type, sender: message.sender, content: message.content as JsonValue, encrypted: encryptionInfo !== null });
    };
    this.client.on(ClientEvent.ReceivedToDeviceMessage, onMessage);
    return this.track(() => this.client.off(ClientEvent.ReceivedToDeviceMessage, onMessage));
  }

  /** The SDK polls the homeserver for TURN credentials while the client runs; this relays them. */
  subscribeTurnServers(sink: TurnServerSink): Subscription {
    const push = (servers: ITurnServer[]) => {
      for (const server of servers) sink.onTurnServer({ uris: server.urls, username: server.username, password: server.credential });
    };
    this.client.on(ClientEvent.TurnServers, push);
    const subscription = this.track(() => this.client.off(ClientEvent.TurnServers, push));
    queueMicrotask(() => {
      if (subscription.active()) push(this.client.getTurnServers());
    });
    return subscription;
  }

  /** Cancel whatever is still subscribed; call when the room view goes away. */
  dispose(): void {
    for (const cancel of [...this.subscriptions]) cancel();
  }

  // ---- Helpers ----

  /** The events of the live timeline that are in the room (sent, with an id), oldest first. */
  private cachedEvents(roomId: string): SdkEvent[] {
    return this.room(roomId)
      .getLiveTimeline()
      .getEvents()
      .filter((ev) => !ev.status && ev.getId() !== undefined);
  }

  /**
   * Report the events of the live timeline that the SDK could not decrypt before and now did
   * (`MatrixEventEvent.Decrypted` after a failure). Not run against a homeserver: which of
   * `ClientEvent.Event` and `MatrixEventEvent.Decrypted` reports the failure first.
   */
  private watchDecrypted(report: (events: MatrixEvent[]) => void): () => void {
    const roomId = this.boundRoomId;
    const room = this.client.getRoom(roomId);
    const cached = room?.getLiveTimeline().getEvents() ?? [];
    const failed = new Set(cached.filter((ev) => ev.isDecryptionFailure()).map((ev) => ev.getId()));
    const onDecrypted = (event: SdkEvent) => {
      const eventId = event.getId();
      if (event.getRoomId() !== roomId || eventId === undefined) return;
      if (event.isDecryptionFailure()) {
        failed.add(eventId);
        return;
      }
      if (!failed.delete(eventId) || !isReadable(event)) return;
      if (room?.getLiveTimeline().getEvents().includes(event)) report([toMatrixEvent(event, roomId)]);
    };
    // An event that arrives undecryptable is remembered, whichever event tells first.
    const onEvent = (event: SdkEvent) => {
      const eventId = event.getId();
      if (event.getRoomId() === roomId && eventId !== undefined && event.isDecryptionFailure()) failed.add(eventId);
    };
    this.client.on(ClientEvent.Event, onEvent);
    this.client.on(MatrixEventEvent.Decrypted, onDecrypted);
    return () => {
      this.client.off(ClientEvent.Event, onEvent);
      this.client.off(MatrixEventEvent.Decrypted, onDecrypted);
    };
  }

  private room(roomId: string): Room {
    const room = this.client.getRoom(roomId);
    if (!room) throw fail(`unknown room ${roomId}`);
    return room;
  }

  private track(stop: () => void): Subscription & { active(): boolean } {
    let active = true;
    const cancel = () => {
      if (!active) return;
      active = false;
      this.subscriptions.delete(cancel);
      stop();
    };
    this.subscriptions.add(cancel);
    return { cancel, active: () => active };
  }
}

/** A js-sdk event as the bindings' `MatrixEvent`: the decrypted event where there is one. */
function toMatrixEvent(event: SdkEvent, roomId: string): MatrixEvent {
  return matrixEventFromJson(JSON.stringify({ room_id: roomId, ...event.getEffectiveEvent() }));
}

/** Whether `event` can be handed to a widget now; an event still waiting for its key cannot. */
function isReadable(event: SdkEvent): boolean {
  return !event.isBeingDecrypted() && !event.isDecryptionFailure() && event.getType() !== "m.room.encrypted";
}

const fail = (reason: string): Error => new BackendError.Failed({ errcode: undefined, status: undefined, reason });

/** Anything the SDK throws, as a `BackendError`; the driver forwards `errcode` and `status` to the widget. */
function toBackendError(e: unknown): Error {
  if (BackendError.instanceOf(e)) return e as Error;
  if (e instanceof MatrixError) return new BackendError.Failed({ errcode: e.errcode, status: e.httpStatus, reason: e.data?.error ?? e.message });
  return fail(e instanceof Error ? e.message : String(e));
}

/** Await an SDK call, turning its rejection into a `BackendError`. */
async function wrap<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (e) {
    throw toBackendError(e);
  }
}

/** The homeserver does not know the endpoint. */
const isUnsupported = (e: unknown): boolean => e instanceof MatrixError && (e.errcode === "M_UNRECOGNIZED" || e.httpStatus === 404);
