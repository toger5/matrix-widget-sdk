# Performance findings: the Timeline tab

What made the Timeline tab slow in the matrix-rust-sdk build (`src/matrix_session/rust/`), what the host does about it, and what would fix it in the SDK so that other clients on `matrix-sdk-ffi` in the browser do not run into it. The open decision that is left is `rust-timeline-open-cost` in [implementation_findings.md](implementation_findings.md).

## How it was measured

- A local Synapse 1.163 (Docker, native sliding sync), one room with 3000 messages from two users (every tenth formatted). The host's dev server, Chromium through Playwright, logged in with a password.
- Timings: from the `tab/openTimeline` intent until the `TimelineView` shows its rows (`timeline-scroller` visible), and around `room.timeline()` and the first `onUpdate` of the view model.
- Where the time goes: every IndexedDB transaction during an open, counted by object store (`IDBDatabase.prototype.transaction` wrapped in an init script), and a CPU profile (DevTools protocol).
- Scenarios: the first open; paging back to the start of the room (all 3000 messages loaded), then closing and opening the tab again; the same with the Dev tools open on the room (they hold the raw event feed).

| Opening the Timeline tab | Before | Now |
|---|---|---|
| First open | ~230 ms (after a wait for the room subscription of up to 5 s) | ~230 ms |
| Again, 3000 messages paginated | ~1.3 s, ~18 000 IndexedDB transactions | ~0.2 s, none |
| Again, 3000 messages paginated, Dev tools open | ~1.3 s | ~0.2 s, none |

## The issues

1. **The timeline waited for the room subscription.** The view model opened the SDK timeline only after `subscribeToRoomWithFullState` resolved (`RustSession.open`, up to `FULL_STATE_TIMEOUT_MS` = 5 s), although the timeline works from what the event cache has.
2. **Read receipts for every event.** `Room::timeline()` of matrix-sdk-ffi tracks read receipts and the read marker. On creation the timeline reads the receipts of every event it adds from the state store: ~12 000 `getAll` on `room_event_receipts` for 3000 events (two timelines in dev, see 6). The tab shows no receipts.
3. **A thread info read for every event.** matrix-sdk-ui reads the `ThreadInfo` of every event it adds (`TimelineStateTransaction`, `crates/matrix-sdk-ui/src/timeline/controller/state_transaction.rs`: "we must fetch the `ThreadInfo` for each new event"), one IndexedDB transaction each on the event cache's `threads` store: ~3000 transactions, ~450 ms for 3000 events. The CPU is mostly idle meanwhile; it is the serial IndexedDB round trips.
4. **Every timeline starts with everything the event cache holds in memory.** `RoomEventCache::subscribe()` hands the new timeline all in-memory events, and 2 and 3 are paid for each. The cache shrinks back to its last chunk only once nothing subscribes to the room:
   - The ffi `Timeline` object lived until the JavaScript garbage collector freed it (uniffi objects in the browser are freed by a `FinalizationRegistry`, or explicitly with `uniffiDestroy()`). Cancelling its listeners did not drop its subscription, so a closed tab kept every event it had paginated in memory, and the next tab started with all of them.
   - The raw event feed of this repository (`subscribe_to_events_raw` in `packages/matrix-sdk-uniffi-js/sdk-additions`, used by widgets' `subscribe_room` and the Dev tools) subscribes to the event cache as well, and widgets paginate it.
5. **Pagination stopped when the first page did not fill the view.** `TimelineView` reports reaching the top (`onStartReached`) only from scroll and layout changes after it has shown its rows. A short first page cannot be scrolled, so nothing loaded until a new event changed the layout.
6. **Two timelines per tab in dev.** React's StrictMode mounts the hook twice; each mount created an SDK timeline, so 2 and 3 were paid twice.
7. **The start position.** `TimelineView` (shared components 0.2.3) scrolls to the newest row before it shows the timeline, but gives up after `REVEAL_TIMEOUT_MS` = 1 s while rows still change height, and is then shown wherever it got to.
8. **No local echo for the composer** (not speed, but it feels slow): it sent through the room backend, `Room::send_raw`, which bypasses the send queue, so the message appeared only when the sync brought it.

## What the host does (workarounds)

| Issue | Workaround | Where |
|---|---|---|
| 1 | The timeline is opened at once; the room subscription runs alongside | `RustSession.timelineViewModel` (`rust/session.ts`) |
| 2 | `timelineWithConfiguration` with `trackReadReceipts: Disabled` (no receipts, no read marker) | `timelineConfiguration()` (`rust/timelineViewModel.ts`) |
| 4 | One SDK timeline per room, shared by its tabs (each adds its own listener, which starts with the current items: no second initialisation). It is freed with `uniffiDestroy()` 60 s after the last tab gave it back, not left to the garbage collector, so the room's event cache can shrink again. Logout frees all | `SharedTimelines` (`rust/timelineViewModel.ts`) |
| 3, 4 | Not avoided: the first open of a room with a full event cache still reads the thread info of every event in memory (finding `rust-timeline-open-cost`) | |
| 5 | The view models also load older events on `onAnchorReached` (the `TimelineView` calls it once its first rows are shown); every loaded page changes the layout again, until the view is full or the start is reached | `timelineStore` (`matrix_session/timelineViewModel.ts`) |
| 6 | The view model is created one task after the effect; StrictMode's first cleanup cancels it before anything is opened | `useTimelineViewModel` (`app/AppRoot.tsx`) |
| 7 | After every open, and after a room switch in the panel, the view keeps the timeline at the bottom until it stayed there for a few frames (at most ~3 s); a wheel, touch, key or pointer press ends this at once | `useStartAtBottom` (`views/rooms/RoomTimeline.tsx`) |
| 8 | The rust composer sends through the timeline (`Timeline::send`, the send queue): a local echo at once. What widgets and the Dev tools send still goes through `send_raw`, because the widget API needs the event ID back | `send` of `rustTimelineViewModel` |

## What would fix it in matrix-rust-sdk

Each of these would help every client that runs the SDK in a browser (IndexedDB stores, one thread, uniffi objects freed by the garbage collector). They are proposals, none is filed yet.

1. **Batch or defer the thread info reads (issue 3).** Read the `ThreadInfo`s of all events of a batch with one store call (for example `load_thread_infos(room_id, &[event_id])`, one IndexedDB transaction), or keep the thread infos of the in-memory events in the event cache's memory, or look them up only for events that can be thread roots and fill summaries in later. A `TimelineBuilder` option to skip thread summaries would serve clients that do not show threads.
2. **Batch the read receipt reads (issue 2).** Load the receipts of a room once when the timeline is built (one `getAll` for the room) instead of per event; in the IndexedDB state store, one transaction per batch rather than per event.
3. **Initialise a timeline from a bounded window (issue 4).** A new timeline should start from the last chunk (or the last N events) of the event cache, not from everything other subscribers have paginated into memory, and paginate the rest from memory on demand. Alternatively a subscription that does not hold the cache in memory, for consumers like the raw feed that only need live updates (`subscribe` vs. a "non-retaining" subscribe), so that the cache can shrink while only those listen.
4. **Reuse IndexedDB transactions for read batches.** One transaction per read is the cost behind 2 and 3: several thousand serial round trips. A read-only transaction shared by a batch of reads, or `getAll` over a key range instead of single gets, would cut it by orders of magnitude.
5. **Make the lifetime of an ffi `Timeline` explicit.** Its subscription holds the room's event cache in memory, but in JavaScript it is dropped only by the garbage collector. A documented `close()`/`dispose()` (or freeing in `TaskHandle::cancel` of its last listener) would make it hard to leak; the docs of `Room::timeline()` should say that it tracks read receipts and what that costs.
6. **The event ID of a queued send (issue 8).** `Timeline::send` and the room's send queue return a `SendHandle` without the event ID. A way to await it (`SendHandle::event_id()`, resolved once sent) would let the widget API and other `send_raw` users go through the send queue and get local echoes.

## Upstream components

- `TimelineView` (`@element-hq/web-shared-components`): its reveal timeout (issue 7) and its silence about the top when the first rows do not fill the view (issue 5) affect every view model. A "keep scrolling to the bottom until settled" mode, and an `onStartReached` once after the reveal when the first row is in view, would remove both workarounds.
