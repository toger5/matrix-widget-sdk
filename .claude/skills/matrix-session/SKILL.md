---
name: matrix-session
description: The Matrix client inside the widget host (packages/widget-host/src/matrix_session) - the matrix-rust-sdk and matrix-js-sdk implementations of LiveSession, where logins and stores live (localStorage keys, IndexedDB names), login and the OAuth popup, suspend/resume while the DevBackend is active (FetchGate, sync service and send queues), device verification (emoji and recovery key, the change listeners, AccountVerification), the tests on faked clients, and how API missing from the rust SDK is added (sdk-additions, new files plus one mod line). Use before changing a session, login, storage, suspend/resume or verification code of the host, and when debugging a logged-in host.
---

# The Matrix sessions of the widget host

Paths are relative to `packages/widget-host/` unless they start with `packages/` or `.claude/`.
The app around it (MVVM, controller, views, DevBackend) is the `widget-host` skill; the
`MatrixBackend` of a room (what a widget's actions turn into) follows the `widget-api-change`
skill, section 4.

**Neither SDK implementation has run against a homeserver beyond the login options.** Everything
after the login is checked by the type checker and by tests on faked clients only. Say so when a
change depends on real SDK behaviour; the open questions are in `implementation_findings.md`,
"Matrix sessions (not run against a homeserver)".

## Files

| file | what |
|---|---|
| `src/session.ts` | the seam: `SessionProvider`, `PendingLogin`, `LiveSession`, `EmojiVerification`, `RoomBackend`, `StoredLoginInvalidError`; `sessions` loads one SDK lazily (`VITE_MATRIX_SDK=js`: matrix-js-sdk, else matrix-rust-sdk; `npm run dev:js`) |
| `src/matrix_session/rust/session.ts` | matrix-rust-sdk (`matrix-sdk-uniffi-js`): provider, pending login, `RustSdkSession` (native sliding sync, room list, widget events of all rooms) |
| `src/matrix_session/rust/roomData.ts`, `verification.ts` | free functions of the client: account and room details, "Copy to DevBackend"; device verification |
| `src/matrix_session/rust/backend/` | `RustSdkBackend` (`MatrixBackend` of one room), `roomFeed.ts`, `events.ts`, `turnServer.ts` |
| `src/matrix_session/js/session.ts` | matrix-js-sdk: provider, pending login, `JsSdkSession` (`/sync` v2, in-memory store, rust crypto in IndexedDB) |
| `src/matrix_session/js/roomData.ts`, `verification.ts`, `fetchGate.ts` | free functions of the client; device verification; the `fetch` that is closed while suspended |
| `src/matrix_session/js/backend/` | `JsSdkBackend`, `events.ts`, `errors.ts` |
| `src/matrix_session/js/accountStore.ts` | `AccountStore`: one `localStorage` entry per login, legacy migration; SDK free, used by both (finding `account-store-location`) |
| `src/matrix_session/verificationCancel.ts` | the reason text of a verification cancel code; SDK free, used by both |
| `src/matrix_session/roomTimelines.ts` | `RoomTimelines`: the start of the room, a running pagination and the listeners of each room's RoomTimeline; SDK free, used by both |
| `src/matrix_session/memory/devBackend.ts` | the DevBackend: the same `LiveSession` without a homeserver (its device is always verified) |
| `src/app/runtime/deviceVerification.ts` | `AccountVerification`: `verified` and the verification flows of one account, for the controller |
| `oidc-callback.html` | the OAuth redirect target, opened in the login popup |

Only `src/matrix_session/{js,rust}/` import an SDK; anything shared by both stays SDK free (check
in the `widget-host` skill). Something added to `LiveSession` is added to rust, js and the
DevBackend.

## Storage

Verify a key before relying on it (`grep -rn STORAGE_PREFIX src/matrix_session`).

| what | where |
|---|---|
| js login | `localStorage` `widget_host_session_v2:<accountId>` (`{ order, record }`, `accountStore.ts`); the old single login `widget_host_session_v1` is migrated to account id `legacy` |
| js crypto store | IndexedDB, prefix `widget-host-js-<accountId>` (`cryptoDatabasePrefix`); the `legacy` login keeps the SDK default (`matrix-js-sdk`) |
| rust login | `localStorage` `widget_host_rust_session_v2:<storeId>` (session, store passphrase, store id = account id); old key `widget_host_rust_session_v1` |
| rust stores | IndexedDB `widget-host-store-<storeId>` plus `::matrix-sdk-state`, `::matrix-sdk-crypto`, `::matrix-sdk-crypto-meta`, `::event_cache`, `::media` (`STORE_SUFFIXES`), encrypted with the passphrase; `deleteStore` removes them on logout |
| approved capabilities | `localStorage` `widget_host_capabilities_v1 <userId> <roomId> <widgetKey>` (`src/lib/capabilityStore.ts`; a local widget's key is `local:<type>/<state key>`); cleared on logout, one widget's when a local widget is removed or its URL (of a legacy widget also its `data`) changes |
| UI layout | `localStorage` `widget_host_ui_v1` (`src/app/persistence.ts`): settings, layout, recents and the local widgets ("Add widget", only in this host) per account; an account's entries go with its logout |

Tokens refreshed by an SDK are written back (`onTokenRefresh` in js, the `ClientSessionDelegate`
in rust), else a reload restores stale ones. A login is stored only once it completes.

## Login, restore, logout

- `provider.startLogin(server)` → `PendingLogin.options` (`oauth`, `password`). Password: `withPassword`.
  OAuth: the controller (`continueLogin`) opens the popup `about:blank` *inside the click*, then
  navigates it to `oauthUrl()`; `oidc-callback.html` posts `{ type: "oidc-callback", callbackUrl }`
  to its opener (same origin only); the controller passes it to `completeOAuth`. A closed popup
  aborts (`abortOAuth`).
- js registers the client dynamically (`OAuth2.registerClient`, PKCE, `state` checked); on a
  loopback host it registers as a native client with client URI `https://element.io`. rust uses
  `urlForOauth` with the same client URI trick. rust refuses a homeserver without native sliding sync.
- `provider.restore(accountId)`: one client per account (the `active` map; strict mode calls it
  twice). A token the homeserver no longer knows rejects with `StoredLoginInvalidError` (js:
  `whoami`; rust: `getMaxMediaUploadSize`), and the controller clears the login; any other failure
  keeps it ("Try again").
- `logout()` revokes the session and deletes the entry and the stores; `clearStored()` does the
  same for a login that is not running.

## Suspend and resume

While the DevBackend is the active account no Matrix request may be made. The controller calls
`suspend()` on every session (`switchAccount`) and `resume()` when leaving it; backends handed out
before stay valid.

- js: every request goes through `FetchGate` (`createClient({ fetchFn: gate.fetch })`): closed, it
  refuses new requests with `SuspendedError` (the SDK sees a lost connection and retries later),
  aborts the `/sync` long poll and lets requests in flight finish. `stopClient()` is not used: it
  ends the crypto module for good. `resume()` reopens the gate and calls `retryImmediately()`.
- rust: `SyncService.stop()` plus `enableAllSendQueues(false)`; reads come from the store, the
  session's own requests (avatars, account and room data) are skipped (`online: false`). A request
  a backend makes for a widget still goes out (finding `rust-suspend-explicit-requests`).
  `Client::pause()` is avoided: it closes the stores. `resume()` restarts both and subscribes to
  the open room again (finding `rust-resume-room-subscription`).
- A read made while suspended may fail (js `needsVerification` downloads keys); the controller reads again after `resume()`.

## Device verification

`LiveSession`: `needsVerification()`, `onVerificationChanged(listener)` (returns the
unsubscribe), `verifyWithRecoveryKey(key)`, `startEmojiVerification()` → `EmojiVerification`
(`emoji` once another device accepted, `ended` rejects with the reason whenever it ends without
success, `confirm()`, `cancel(mismatch?)`, a no-op once over).

- rust (`rust/verification.ts`): `encryption().verificationState()` after
  `waitForE2eeInitializationTasks()`; the listener is `encryption().verificationStateListener`,
  whose `TaskHandle` must be kept and `cancel()`ed (dropping it aborts the task). The recovery key
  goes to `encryption().recover()`. Emoji: `getSessionVerificationController()` (one per client,
  so its delegate and cancel infos outlive a verification), a delegate,
  `requestDeviceVerification` → `startSasVerification` on accept → `approveVerification` /
  `declineVerification` / `cancelVerification`; the cancel code that names the reason is in
  `sasCancelInfo()` once the SAS has started, else in `requestCancelInfo()`. A uniffi error's
  `message` is only its type ("RecoveryError.SecretStorage"); `sdkError` takes the text from `inner`.
- js (`js/verification.ts`): `userHasCrossSigningKeys` + `getDeviceVerificationStatus(...).crossSigningVerified`;
  the listener is `CryptoEvent.UserTrustStatusChanged` / `KeysChanged` / `DevicesUpdated`, own user
  only. `userHasCrossSigningKeys` downloads the own keys on every call, so `needsVerification` is
  not for polling. The recovery key is decoded and checked against the default secret storage key
  (`secretStorage.getDefaultKeyId` / `getKey` / `checkKey`); then the `RecoveryKeySlot` hands it to
  the client's `getSecretStorageKey` crypto callback, for that key id only and only while
  `bootstrapCrossSigning` runs (then its bytes are overwritten). It is refused first when
  `getCrossSigningStatus().privateKeysInSecretStorage` is false: the SDK would then create new
  cross-signing keys and write them to the secret storage instead of reading it. Emoji:
  `requestOwnUserVerification`, the request's phases, the SAS verifier, `checkKeyBackupAndEnable`
  afterwards.
- After both sides confirmed, `confirm()` waits up to 20 s (polling; js reads the stored device,
  no download) for the other device's signature to arrive; until then `needsVerification()` still
  says true. `cancel()` ends the wait.
- `AccountVerification` (one per adopted session, created in `adoptSession`, disposed in
  `forgetAccount` / before `logout`): reads `needsVerification` at the start, on every change
  notification and on `refresh()` (after `resume()`); only the newest read counts. It runs one
  flow at a time and ignores results of a cancelled one (one that succeeded anyway only triggers
  a read); on success it reports `verified: true` and the "done" step at once, then reads again.
  A read that finds the device verified while a step runs (verified elsewhere) ends that step the
  same way, cancelling the SDK's flow. It reports `{ verified, verification }`
  (`AccountViewModel`) and the outcome (a toast if the AccountView is closed). Activating the
  DevBackend `stop()`s a running flow (finding `verification-cancel-on-suspend`).
- The recovery key is a secret: it passes from the form's own state through the intent to the
  session and is never stored, put in the view model or logged (`loggableIntent` in `src/appViewModel.ts`).
- Not supported: a request another device sends to this one (finding `verification-incoming-requests`).

## Tests on faked clients

| test | covers |
|---|---|
| `test/rustSessionData.test.ts` | rust `roomData` and `verification` on a faked `ClientLike` (loads the SDK's wasm for its enums) |
| `test/jsSessionData.test.ts` | js `roomData`, `verification` (a faked client and request on `EventEmitter`) and `FetchGate` |
| `test/rustSdkBackend.test.ts`, `test/jsSdkBackend.test.ts`, `test/backendContract.ts` | the `MatrixBackend`s behind the real driver wasm |
| `test/accountStorage.test.ts` | `AccountStore`, legacy migration, clearing one account (faked `localStorage`, `indexedDB`, `fetch`) |
| `test/deviceVerification.test.ts` | `AccountVerification` on a faked `LiveSession` |

New session logic goes into free functions of the client (like `roomData.ts`, `verification.ts`)
so these tests can drive it; the session classes only hold state and delegate.

## API the rust SDK lacks

It is added in `packages/matrix-sdk-uniffi-js/sdk-additions/`, as **new Rust files plus one `mod`
line each** (inserted by `declare_module` in `packages/matrix-sdk-uniffi-js/scripts/build.sh`);
never as a diff to an upstream file. List the addition in that package's README ("API added to
the SDK") and rebuild the bindings (`npm run bindings -w packages/matrix-sdk-uniffi-js`, slow).
