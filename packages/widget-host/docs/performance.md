# Performance findings: the Timeline tab (rust build)

Why opening the Timeline tab of `src/matrix_session/rust/` is costly in matrix-rust-sdk on the web, what the host does about it, and fixes to propose upstream (none filed yet). The open decision is `rust-timeline-open-cost` in [findings.md](findings.md).

Measured on a local Synapse 1.163 (native sliding sync), one room with 3000 messages, Chromium through Playwright: IndexedDB transactions per open counted by object store, plus a CPU profile. With the workarounds below, opening the tab takes ~230 ms the first time and ~0.2 s again after all 3000 messages were paginated (no IndexedDB transaction), with or without the Dev tools open.

## Costs in the SDK

1. **Read receipts per event.** `Room::timeline()` of matrix-sdk-ffi tracks read receipts: a new timeline reads the receipts of every event it adds (~12 000 `getAll` on `room_event_receipts` for 3000 events).
2. **Thread info per event.** matrix-sdk-ui reads the `ThreadInfo` of every event it adds (`TimelineStateTransaction`, `crates/matrix-sdk-ui/src/timeline/controller/state_transaction.rs`), one IndexedDB transaction each: ~450 ms for 3000 events, serial round trips with the CPU mostly idle.
3. **Every timeline starts with everything the event cache holds in memory.** `RoomEventCache::subscribe()` hands a new timeline all in-memory events, and 1 and 2 are paid for each. The cache shrinks to its last chunk only once nothing subscribes, but an ffi `Timeline` lives until the JavaScript garbage collector frees it (cancelling its listeners does not drop its subscription), and the raw event feed of this repository (`subscribe_to_events_raw` in `packages/matrix-sdk-uniffi-js/sdk-additions`, used by widgets' `subscribe_room` and the Dev tools) subscribes as well.
4. **No event ID for a queued send.** `Timeline::send` and the send queue return a `SendHandle` without the event ID, so what needs it back (the widget API) uses `send_raw` and gets no local echo.

`TimelineView` of `@element-hq/web-shared-components` 0.2.3 adds two: it gives up scrolling to the newest row after `REVEAL_TIMEOUT_MS` = 1 s while rows still change height, and reports reaching the top only from scroll and layout changes, so a first page that does not fill the view loads nothing more.

## What the host does

| Cost | Workaround | Where |
|---|---|---|
| waiting for the room subscription | the timeline opens at once; the full-state room subscription runs alongside | `RustSession.timelineViewModel` (`rust/session.ts`) |
| 1 | `trackReadReceipts: Disabled` (no receipts, no read marker) | `timelineConfiguration()` (`rust/timelineViewModel.ts`) |
| 3 | one SDK timeline per room, shared by its tabs, freed with `uniffiDestroy()` 60 s after the last tab gave it back; logout frees all | `SharedTimelines` (`rust/timelineViewModel.ts`) |
| 2, 3 | not avoided: the first open of a room with a full event cache reads the thread info of every event in memory | finding `rust-timeline-open-cost` |
| StrictMode mounts twice in dev | the view model is created one task after the effect, so the first cleanup cancels it before a timeline opens | `useTimelineViewModel` (`app/AppRoot.tsx`) |
| top not reported | the view models also load older events on `onAnchorReached`, until the view is full or the start is reached | `timelineStore` (`matrix_session/timelineViewModel.ts`) |
| reveal timeout | the view stays at the bottom until it stayed there for a few frames (at most ~3 s); a wheel, touch, key or pointer press ends it | `useStartAtBottom` (`views/rooms/RoomTimeline.tsx`) |
| 4 | the composer sends through `Timeline::send` (local echo); widgets and the Dev tools still use `send_raw` | `send` of `rustTimelineViewModel` |

## Fixes to propose to matrix-rust-sdk

1. Read the `ThreadInfo`s of a batch with one store call (e.g. `load_thread_infos(room_id, &[event_id])`), or keep them in memory, or a `TimelineBuilder` option to skip thread summaries.
2. Load a room's receipts once when the timeline is built, not per event.
3. Start a new timeline from the last chunk of the event cache, or offer a subscription that does not hold the cache in memory (for consumers like the raw feed).
4. Share one read-only IndexedDB transaction across a batch of reads, or `getAll` over a key range, instead of one transaction per read.
5. An explicit `close()`/`dispose()` on the ffi `Timeline` (or free it when its last listener's `TaskHandle` is cancelled), and document what `Room::timeline()` tracks.
6. `SendHandle::event_id()`, resolved once sent, so `send_raw` users can go through the send queue.

Upstream `TimelineView`: a "keep scrolling to the bottom until settled" mode and an `onStartReached` after the reveal when the first row is in view would remove the last two workarounds.
