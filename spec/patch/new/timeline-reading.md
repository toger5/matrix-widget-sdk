> **Draft in matrix-widget-sdk.** Status: draft. Implemented here: `crates/widget-actions`
> (`read_timeline.rs`, `paginate_timeline.rs`, `notify_timeline_update.rs`, `ErrorKind::EventNotCached`),
> the driver (`crates/widget-host-driver`), the backend trait (`timeline_read`,
> `timeline_paginate_backwards`, `subscribe_timeline`) with `InMemoryBackend` and both SDK backends of
> `packages/widget-host`, the widget SDK (`readTimeline`, `paginateTimeline`, `onTimelineUpdate`); no
> rate limiting of `m.paginate_timeline` (plan: `session_archive/todo-groups/21-timeline-reading.md`). Replaces this repository's
> `read_events` (MSC2876); legacy widgets keep `read_events` through the compat wrapper
> (`packages/widget-compat-wrapper`), which translates it into the actions below.
> Related patches: none. Remove this block when opening the MSC.

# MSCXXXX: Reading the room timeline from the client's cache

Widgets that show history (a chat view, a poll list, a whiteboard that replays its strokes) need
the events that happened before they were loaded. Today they use `read_events` of
[MSC2876](https://github.com/matrix-org/matrix-spec-proposals/pull/2876): "give me the last N
events of type X". This has several problems:

 * There is no cursor. A widget cannot ask for the events *before* the ones it already has, so it
   cannot page through history.
 * The client decides whether it answers from its local store or from the homeserver. When the
   answer has fewer than N events, the widget cannot tell whether the room has no more events or
   the client did not look further.
 * When the client goes to the homeserver, the answer may take longer than the request timeout of
   [MSC4412](https://github.com/matrix-org/matrix-spec-proposals/pull/4412) (10 seconds).
 * Live events arrive with `forward_event` ([MSC2762](https://github.com/matrix-org/matrix-spec-proposals/pull/2762)).
   The widget cannot tell how the events of a read relate to the events it was forwarded, and it
   is never told when the client's view of the room has a gap (after a limited sync).

Clients already keep a cache of each room's timeline, and they extend it backwards on demand
(back-pagination). This MSC lets a widget read that cache directly with a cursor, ask the client
to extend it, and be told when the cache changed in a way that `forward_event` does not cover.

## Proposal

Three actions are added. Each has its own capability, and each makes sense on its own:

| action | direction | capability |
|---|---|---|
| `m.read_timeline` | widget → client | `widget:m.read_timeline:<event type>[#<msgtype>]` |
| `m.paginate_timeline` | widget → client | `widget:m.paginate_timeline` |
| `m.notify_timeline_update` | client → widget | `host:m.notify_timeline_update` |

Every action answers at once. Nothing in this MSC waits for the homeserver inside a request.

### The timeline cache

The client keeps, per room, a contiguous part of the room's timeline: from the newest event it
knows back to some older event. This MSC calls it the *timeline cache*. It is the same timeline
that `forward_event` extends at its newest end.

The client knows one *pagination status* for the room's timeline cache:

 * `idle`: the cache does not reach the start of the room, and no pagination is running.
 * `paginating`: the client is fetching older events from the homeserver.
 * `start_reached`: the cache contains the room's first event. There is nothing older.

How large the cache is, and when the client drops parts of it, is up to the client.

### `m.read_timeline` (widget → client)

Reads events from the timeline cache, from newest to oldest. It never contacts the homeserver.

```json5
{
  source: "widget",
  action: "m.read_timeline",
  request_id: "1",
  request: {
    from: "$oldest_event_the_widget_has", // optional
    limit: 50,
    filter: [                              // optional
      { type: "m.room.message", msgtype: "m.text" },
      { type: "m.reaction" },
    ],
  },
  response: {
    events: [ /* client-format events, newest first */ ],
    pagination: "idle",
  },
}
```

Request:

 * `from` (string, optional): an event ID. The read starts with the event *before* (older than)
   this event, which itself is not returned. Without `from`, the read starts with the newest event
   of the cache. The event does not need to be one the widget may read, but it has to be in the
   cache.
 * `limit` (integer, required): the largest number of events to return. The client MAY return
   fewer than asked (see below) and MAY clamp large values, but MUST NOT return more.
 * `filter` (array, optional): the events to return, as objects with a `type` and an optional
   `msgtype` (only for `m.room.message`). Without `filter`, every event the widget may read is
   returned.

Response:

 * `events`: the events, newest first, in the client-server API's client format. Only events the
   widget holds a `m.read_timeline` capability for (and that match `filter`) are returned. Events
   the client cannot decrypt are left out.
 * `pagination`: the pagination status at the time of the answer.

The client walks the cache from `from` towards older events until it has `limit` matching events
or the cache ends. So:

 * If `events` has `limit` events, there may be older ones. The widget reads again with `from` set
   to the oldest of them.
 * If `events` has fewer than `limit` events, the cache has no more matching events older than the
   last one returned. `pagination` says what is next: `idle` means the widget can call
   `m.paginate_timeline`, `paginating` means older events are on their way, `start_reached` means
   the widget has everything.

Errors:

 * `m.missing_capability` when the widget holds no `m.read_timeline` capability.
 * `m.event_not_cached` when `from` is not in the timeline cache: it never was, or the client
   dropped it (see `reset` below). The widget reads again without `from`.

Timeline events that are state events (for example `m.room.member` changes) are returned like any
other event. The current room state is not part of this action; widgets receive it with
`update_state`.

### `m.paginate_timeline` (widget → client)

Asks the client to extend the timeline cache backwards. The answer comes at once and says what the
client did; the outcome follows with `m.notify_timeline_update`.

```json5
{
  source: "widget",
  action: "m.paginate_timeline",
  request_id: "2",
  request: { limit: 50 },        // optional
  response: { pagination: "paginating" },
}
```

 * `limit` (integer, optional): a hint for how many events to fetch. The client may fetch more or
   fewer.
 * If the status is `idle`, the client starts a back-pagination and answers `paginating`.
 * If the status is `paginating`, the request joins the running one; the client answers
   `paginating`.
 * If the status is `start_reached`, the client does nothing and answers `start_reached`.
 * The response carries an error only for problems the client knows before it starts, for example
   `m.missing_capability`, or `m.unknown` when the client refuses because the widget paginates too
   often. A failure of the homeserver request is reported with `m.notify_timeline_update`.

The capability `widget:m.paginate_timeline` has no data. A widget that holds `m.read_timeline`
capabilities but not this one can read what the client already has, without causing requests to
the homeserver.

### `m.notify_timeline_update` (client → widget)

Tells the widget that the timeline cache changed in a way `forward_event` does not cover. It does
not carry the changed events: the widget reads them with `m.read_timeline`. The widget acknowledges
with an empty response.

```json5
{
  source: "host",
  action: "m.notify_timeline_update",
  request_id: "3",
  request: {
    pagination: { status: "idle" },   // optional
    reset: true,                      // optional
    decrypted: ["$event_id"],         // optional
  },
  response: {},
}
```

The client sends it to every widget of the room that holds `host:m.notify_timeline_update`:

 * **When the pagination status changes** (`pagination`). It is sent no matter which widget, or the
   client itself, started the pagination. The client sends it after the fetched events are in the
   cache, so a `m.read_timeline` right after it sees them. When a pagination failed, the status
   goes back to `idle` and `pagination.error` carries the error, in the error format of MSC4412.
 * **When the cache is no longer continuous** (`reset: true`): after a limited sync left a gap
   behind the newest events, or after the client dropped or rebuilt the cache. The events the
   widget read or was forwarded before may not connect to the events that follow, and their IDs
   may no longer be valid for `from`. The widget reads again without `from`.
 * **When cached events became readable** (`decrypted`): the IDs of events in the cache that the
   client could not decrypt before and that the widget may now read. The widget reads again over
   the part of the timeline it shows.

The capability `host:m.notify_timeline_update` has no data. On its own it lets a widget that only
uses `forward_event` learn about gaps (`reset`).

### How the actions work together

A widget that shows history:

1. reads with `m.read_timeline` without `from`, then with `from` set to the oldest event it has;
2. when an answer has fewer than `limit` events and `pagination` is `idle`, calls
   `m.paginate_timeline`;
3. on `m.notify_timeline_update` with `pagination.status` `idle` or `start_reached`, reads again
   with the same `from`;
4. receives new events with `forward_event`. `m.read_timeline` without `from` and `forward_event`
   meet at the newest event. An event may arrive both ways; widgets deduplicate by event ID.

### Replacing `read_events`

This MSC replaces the timeline part of MSC2876's `read_events`. Reading the current room state,
the other part of `read_events`, is covered by `update_state`. Clients that implement this MSC do
not need `read_events` for new widgets. Widgets written against the old API can be served by a
translation layer that turns a `read_events` request into `m.read_timeline` reads (and
`m.paginate_timeline` while the answer is short), and serves state reads from `update_state`.

## Potential issues

 * **Sparse event types.** A widget that reads a rare event type in a room with much traffic makes
   the client walk a large part of the cache, and may need many paginations to fill `limit`. This
   is the cost of a filtered read on any timeline; the widget can ask for a smaller `limit`.
 * **Threads.** `m.read_timeline` returns thread events together with the main timeline, ordered
   as the client's cache orders them. Reading one thread is left to a future MSC (or to
   `read_relations`, MSC3869).
 * **Redactions.** A widget that reads `m.room.message` but not `m.room.redaction` does not learn
   that a message it showed was redacted. Requesting the redaction events it needs is the widget's
   responsibility (see Alternatives).
 * **Polling without notifications.** A widget that holds `m.paginate_timeline` but not
   `m.notify_timeline_update` only learns that a pagination finished by reading again.

## Alternatives

### A read that paginates by itself

`m.read_timeline` could start a back-pagination whenever it cannot fill `limit`, and say so in its
answer. This saves a round trip, but a read then has a side effect: a widget that reads again to
redraw can cause homeserver requests without meaning to, it cannot ask "what is cached right now",
and the outcome of a failed pagination has nowhere to go. A separate action also gets its own
capability, so a client can allow reading without allowing requests to the homeserver.

### A slow action: request, acknowledgement, later delivery

The widget could ask for N events, the client acknowledge at once, and a later client → widget
action deliver the events, naming the request. This stays within the request timeout, and is the
simplest for a widget to call. But the events delivered that way are a snapshot that can go stale
(redacted, decrypted later), the cache still needs a notification for changes that concern no
request (gaps, decryptions), so events would reach the widget in two ways, and the envelope would
need responses that refer to an earlier request. A widget SDK can offer the "give me N events" call
on top of this MSC instead (read, paginate while short, wait for the notification, read again).

### Answering `m.paginate_timeline` when the pagination is done

This keeps the outcome in the response, but a back-pagination can take longer than the 10 second
request timeout of MSC4412.

### Other names for `m.notify_timeline_update`

`update_event_cache` or `update_timeline` follow the `update_*` actions of MSC2762 (`update_state`)
and MSC4412 (`update_capabilities`). Those carry the new state itself; this action deliberately
does not carry the changed events, which the `notify_` prefix expresses (as in `notify_ready`).
Splitting it into `update_pagination` and `notify_timeline_reset` was also considered; one action
keeps one listener and one capability.

### Server pagination tokens

`m.read_timeline` could hand out the homeserver's `/messages` tokens, as `read_relations`
(MSC3869) does. That ties widgets to the homeserver's pagination and bypasses the client's cache,
so the client would fetch events it already has, and the widget could not tell cached history from
fetched history.

### Allowing redactions with every read capability

A client could grant `widget:m.read_timeline:m.room.redaction` (and forward redactions) to every
widget that may read some event type, so a widget never shows redacted content by mistake. This
would show the widget redactions of events it may not read, and makes a capability imply another.
This MSC leaves it to the widget to request the redactions it needs.

## Security considerations

 * A widget only receives events it holds a `m.read_timeline` capability for. The `decrypted` list
   of `m.notify_timeline_update` only names events the widget may read. `from` may name an event
   the widget cannot read, but answering it reveals nothing beyond whether that ID is cached.
 * `m.paginate_timeline` causes requests to the homeserver. Clients SHOULD rate-limit it per
   widget, and answer `m.unknown` when a widget paginates too often.
 * `m.notify_timeline_update` reveals that a pagination ran or that a limited sync happened, not
   which events arrived.

## Unstable prefix

While this MSC is not merged:

| stable | unstable |
|---|---|
| `m.read_timeline` | `org.matrix.mscXXXX.read_timeline` |
| `m.paginate_timeline` | `org.matrix.mscXXXX.paginate_timeline` |
| `m.notify_timeline_update` | `org.matrix.mscXXXX.notify_timeline_update` |
| `widget:m.read_timeline:<type>[#<msgtype>]` | `widget:org.matrix.mscXXXX.read_timeline:<type>[#<msgtype>]` |
| `widget:m.paginate_timeline` | `widget:org.matrix.mscXXXX.paginate_timeline` |
| `host:m.notify_timeline_update` | `host:org.matrix.mscXXXX.notify_timeline_update` |
| error code `m.event_not_cached` | `org.matrix.mscXXXX.event_not_cached` |

## Dependencies

This MSC builds on [MSC4412](https://github.com/matrix-org/matrix-spec-proposals/pull/4412)
(envelope, capability format, errors, timeouts). It refers to `forward_event` and `update_state`
of [MSC2762](https://github.com/matrix-org/matrix-spec-proposals/pull/2762).
