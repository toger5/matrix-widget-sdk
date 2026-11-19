---
name: matrix-session
description: The Matrix client inside the widget host (packages/widget-host/src/matrix_session) - the matrix-rust-sdk and matrix-js-sdk implementations of LiveSession, where logins and stores live (localStorage keys, IndexedDB names), login and the OAuth popup, suspend/resume while the DevBackend is active (FetchGate, sync service and send queues), device verification (emoji and recovery key, the change listeners, AccountVerification), the tests on faked clients, and how API missing from the rust SDK is added (sdk-additions, new files plus one mod line). Use before changing a session, login, storage, suspend/resume or verification code of the host, and when debugging a logged-in host.
---

# The Matrix sessions of the widget host

Paths are relative to `packages/widget-host/`. The app around it is the `widget-host` skill; a
room's `MatrixBackend` follows the `widget-api-change` skill, section 4.

**Neither SDK implementation has run against a homeserver beyond the login options.** Everything
after login is checked by tsc and tests on faked clients only. Say so when a change depends on real
SDK behaviour; open questions are in `implementation_findings.md` ("Matrix sessions").

## Files

- `src/session.ts`: the seam (`SessionProvider`, `PendingLogin`, `LiveSession`, `EmojiVerification`,
  `RoomBackend`, `StoredLoginInvalidError`); `sessions` loads one SDK lazily (`VITE_MATRIX_SDK=js`
  for matrix-js-sdk, else matrix-rust-sdk).
- `src/matrix_session/rust/`: matrix-rust-sdk (`matrix-sdk-uniffi-js`, native sliding sync):
  `session.ts`, free functions in `roomData.ts` and `verification.ts`, `backend/` (`RustSdkBackend`).
- `src/matrix_session/js/`: matrix-js-sdk (`/sync` v2, in-memory store, rust crypto in IndexedDB):
  `session.ts`, `roomData.ts`, `verification.ts`, `fetchGate.ts`, `backend/` (`JsSdkBackend`).
- SDK-free code shared by both sits directly in `src/matrix_session/`: `accountStore.ts` (the
  stored logins; `RunningClients`, one client per account), `shared.ts` (`awaitVerified`,
  `verificationCancelReason`, `roleFor`, member and export limits, `appUrl`), and
  `roomTimelines.ts` / `timelineFeed.ts` (a widget's `paginate_timeline` and the Timeline tab's
  "Load older events" are one pagination).
- `src/matrix_session/memory/devBackend.ts`: the same `LiveSession` without a homeserver.
- `src/app/runtime/deviceVerification.ts`: `AccountVerification`, for the controller.
- `public/oidc-callback.html`: the OAuth redirect target (static, copied as is), opened in the login popup.

Only `src/matrix_session/{js,rust}/` import an SDK. Something added to `LiveSession` is added to
rust, js and the DevBackend. New session logic goes into free functions of the client (like
`roomData.ts`, `verification.ts`) so the faked-client tests can drive it.

## Storage

Verify a key before relying on it (`grep -rn STORAGE_PREFIX src/matrix_session`).

| what | where |
|---|---|
| js login | `localStorage` `widget_host_session_v2:<accountId>` (`{ order, record }`); old `widget_host_session_v1` is migrated to account id `legacy` |
| js crypto | IndexedDB prefix `widget-host-js-<accountId>`; the `legacy` login keeps the SDK default |
| rust login | `localStorage` `widget_host_rust_session_v2:<storeId>` (session, store passphrase; store id = account id); old `widget_host_rust_session_v1` |
| rust stores | IndexedDB `widget-host-store-<storeId>` plus the `STORE_SUFFIXES`, encrypted with the passphrase; removed on logout |
| approved capabilities | `localStorage` `widget_host_capabilities_v2 <userId> <roomId> <widgetKey>` = `{ url, capabilities }` (`src/lib/capabilityStore.ts`), bound to the iframe URL; cleared on logout |
| UI layout | `localStorage` `widget_host_ui_v1` (`src/app/persistence.ts`) |

Tokens refreshed by an SDK must be written back (`onTokenRefresh` in js, the `ClientSessionDelegate`
in rust), else a reload restores stale ones. A login is stored only once it completes.

## Login, restore, logout

- OAuth: the controller opens the popup `about:blank` *inside the click*, then navigates it to
  `oauthUrl()`; `oidc-callback.html` posts `{ type: "oidc-callback", callbackUrl }` to its opener
  (same origin only) for `completeOAuth`. A closed popup aborts. Both SDKs register the client
  dynamically; on a loopback host with client URI `https://element.io`. rust refuses a homeserver
  without native sliding sync.
- `restore(accountId)`: one client per account (strict mode calls it twice). A token the server no
  longer knows rejects with `StoredLoginInvalidError` and the login is cleared; any other failure
  keeps it ("Try again").
- `logout()` revokes and deletes the entry and the stores; `clearStored()` does it for a login that
  is not running.

## Suspend and resume

While the DevBackend is active no Matrix request may be made: the controller calls `suspend()` on
every session and `resume()` when leaving; backends handed out before stay valid.

- js: every request goes through `FetchGate`; closed, it refuses new requests with `SuspendedError`
  (the SDK retries later), aborts the `/sync` long poll, lets requests in flight finish.
  `stopClient()` is not used: it ends the crypto module for good.
- rust: `SyncService.stop()` plus `enableAllSendQueues(false)`; the session's own requests are
  skipped (`online: false`), a backend's request for a widget still goes out. `Client::pause()` is
  avoided: it closes the stores. `resume()` restarts both and resubscribes the open room.
- A read made while suspended may fail; the controller reads again after `resume()`.

## Device verification

`LiveSession`: `needsVerification()`, `onVerificationChanged(listener)`, `verifyWithRecoveryKey(key)`,
`startEmojiVerification()` → `EmojiVerification` (`emoji`, `ended`, `confirm()`, `cancel(mismatch?)`).

- rust: the `verificationStateListener`'s `TaskHandle` must be kept and `cancel()`ed (dropping it
  aborts the task). `getSessionVerificationController()` is one per client, so its delegate and
  cancel infos outlive a verification; the cancel reason is in `sasCancelInfo()` once SAS started,
  else `requestCancelInfo()`. A uniffi error's `message` is only its type; take the text from `inner`.
- js: `userHasCrossSigningKeys` downloads keys on every call, so `needsVerification` is not for
  polling. The recovery key is checked against the default secret storage key and handed to the
  `getSecretStorageKey` callback only for that key id and only while `bootstrapCrossSigning` runs.
  It is refused when `privateKeysInSecretStorage` is false: the SDK would create new cross-signing
  keys instead of reading them.
- After both sides confirmed, `confirm()` waits up to 20 s for the other device's signature; until
  then `needsVerification()` still says true.
- `AccountVerification` (one per adopted session): only the newest read counts; one flow at a time;
  results of a cancelled flow are ignored; verified elsewhere ends a running step. Activating the
  DevBackend stops a running flow.
- The recovery key is a secret: never stored, put in the view model or logged (`loggableIntent`).
- Not supported: a request another device sends to this one.

## Tests on faked clients

`test/rustSessionData.test.ts`, `test/jsSessionData.test.ts` (incl. `FetchGate`),
`test/rustSdkBackend.test.ts`, `test/jsSdkBackend.test.ts` + `test/backendContract.ts` (behind the real
driver wasm), `test/accountStorage.test.ts`, `test/deviceVerification.test.ts`.

## API the rust SDK lacks

Added in `packages/matrix-sdk-uniffi-js/sdk-additions/` as **new Rust files plus one `mod` line
each** (inserted by `declare_module` in `packages/matrix-sdk-uniffi-js/scripts/build.sh`), never as
a diff to an upstream file. List it in that package's README and rebuild
(`npm run bindings -w packages/matrix-sdk-uniffi-js`, slow).
