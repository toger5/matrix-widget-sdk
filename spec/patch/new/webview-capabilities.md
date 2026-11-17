> **Draft in matrix-widget-sdk.** Status: draft. Implemented here: the capabilities
> (`crates/matrix-widget-actions/src/capabilities.rs`, `Capability::WebviewSandbox` / `WebviewAllow`), the
> host driver's policy and the iframe attributes (`crates/matrix-widget-host-driver/src/webview.rs`:
> `WebviewPolicy`, `webview_attributes`), the reload (the driver's `WidgetHostPlatform::load_iframe`,
> `crates/matrix-widget-host-driver/src/driver/mod.rs` `State::sync_iframe`; the reloaded page gets
> everything the widget held without asking, `DriverSnapshot::carried`), the widget host's new
> iframe and its guard (`packages/widget-host/src/app/runtime/widgetRuntime.ts`,
> `src/app/controller.ts` `loadIframe`), the compat
> wrapper's legacy set (`packages/widget-compat-wrapper/src/capabilities.ts`
> `LEGACY_WEBVIEW_CAPABILITIES`, `src/wrapper.ts` `innerIframe`). The widget host's permission
> prompt lists them as "Browser permissions", with risk marks
> (`packages/widget-host/src/views/widget/format.ts`).
> Related patches: [`../msc4411/strict-webview-defaults.md`](../msc4411/strict-webview-defaults.md)
> (the strict default this builds on), [`../msc4412/capability-sources.md`](../msc4412/capability-sources.md)
> (the capability source `webview`). Remove this block when opening the MSC.

# MSCXXXX: Webview capabilities for widgets

A widget runs in a webview of the client: an iframe on the web, a native webview elsewhere. What the
widget may do there, beyond running scripts, is decided by the iframe's `sandbox` attribute (forms,
popups, downloads, modal dialogs, ...) and its `allow` attribute, the Permissions Policy (camera,
microphone, screen capture, clipboard, fullscreen, ...). Native webviews have equivalent switches.

Today every widget gets the same fixed set, the one Element Web uses, and
[MSC4411](https://github.com/matrix-org/matrix-spec-proposals/pull/4411) used to recommend it: a poll
widget may use the camera and read the clipboard, and a widget that needs something else cannot get
it. The proposed change to MSC4411 makes the default strict (`sandbox="allow-scripts allow-same-origin"`,
nothing in `allow`) and leaves everything else to the widget's request.

This MSC defines that request: webview capabilities, negotiated like every other capability of the
widget API ([MSC4412](https://github.com/matrix-org/matrix-spec-proposals/pull/4412)). The widget
asks, the client (usually the user) decides, the widget learns what it holds from
`m.update_capabilities`, and the client applies the grant to the webview.

## Proposal

### The capability source `webview`

A webview capability is a capability of the source `webview` (a source defined by another MSC than
MSC4412, see its proposed "Capability sources"). It is about no action:

```
webview:m.sandbox:<token>     a token of the iframe's `sandbox` attribute
webview:m.allow:<feature>     a feature of the iframe's `allow` attribute (Permissions Policy)
```

 * One token or one feature per capability, as the web platform names it: `webview:m.sandbox:allow-popups`,
   `webview:m.allow:camera`, `webview:m.allow:clipboard-write`.
 * The value consists of lower case ASCII letters, digits and `-`, starts with a letter and has at
   most 64 characters. Anything else (a space, `;`, `'`, `*`, `=`, upper case) is no webview
   capability: a client treats it as unknown and grants nothing. This keeps every grant a single
   token and keeps anything else out of the attributes.
 * A value the client does not know (a new token or feature) can be granted; the platform ignores
   what it does not support.
 * `m.request_capabilities`, `m.update_capabilities` and MSC4412's rules apply unchanged: the widget
   requests, the host grants and revokes, `allowed` is always the full list.

### The default and what is never granted

The webview starts strict (MSC4411): `sandbox="allow-scripts allow-same-origin"`, an empty `allow`.

 * **Base:** `webview:m.sandbox:allow-scripts` and `webview:m.sandbox:allow-same-origin` are part of
   every webview. A host grants them when requested, without asking. A widget does not need to
   request them; requesting them lets it see in `m.update_capabilities` that it has them.
 * **Never:** `webview:m.sandbox:allow-top-navigation` and the other `allow-top-navigation` tokens
   let the widget navigate the client away. A host never grants them and does not ask the user
   about them (MSC4411: "Clients MUST NOT allow a widget to navigate the client itself").
 * **Everything else** is granted only if the user (or the client's policy) approves it. Clients
   SHOULD mark the capabilities that matter in the prompt: `allow:camera`, `allow:microphone`,
   `allow:display-capture`, `allow:clipboard-read`, `sandbox:allow-modals` (a modal dialog blocks the
   whole client), `sandbox:allow-popups-to-escape-sandbox` (the popup runs without the widget's
   restrictions), the hardware features (`usb`, `serial`, `hid`, `bluetooth`, ...).

### Applying a grant

On the web the attributes of an iframe apply when it loads. A client applies a grant by loading the
widget again with the new attributes:

1. The widget requests webview capabilities, best before `m.notify_ready`, so that the reload happens
   before the user sees the widget.
2. The host decides and sends `m.update_capabilities` (with the base, which needs no decision, and
   without the never-granted ones).
3. If the widget now holds a webview capability its webview lacks, the client loads the widget again,
   with the attributes of everything it holds (on the web: a new iframe). The widget starts from
   scratch; it does not get the attributes "live".
4. In the new webview the widget requests the same capabilities again. The host grants them without
   asking, because the webview has them already, and does not reload.

Rules that keep this from looping:

 * A client reloads only for a webview capability that is granted and not applied; never for a
   denial, never for the base.
 * After the reload the widget's request is granted from what was applied, without a prompt, so it
   causes no further reload.
 * A client SHOULD stop reloading a widget that keeps causing reloads (for example more than two
   within ten seconds) and show an error instead.

Revoking a webview capability the webview has (the user takes the camera away) also reloads the
widget, without it; `m.update_capabilities` first, as for any revocation.

Remembering: a client that remembers what the user allowed (MSC4412) remembers webview capabilities
like any other and builds the webview with them from the first load, so the request at start is
granted without a prompt and without a reload.

A widget without the widget API cannot request anything and keeps the strict default (MSC4411). A
client MAY let the user grant it more by hand; the grant applies with the next load.

### Native clients

A native client maps each capability to its webview's mechanism, and grants (or refuses) what has no
equivalent like anything else. For example:

| capability | Android `WebView` | iOS `WKWebView` |
|---|---|---|
| `webview:m.sandbox:allow-scripts` | `setJavaScriptEnabled(true)` | `allowsContentJavaScript` |
| `webview:m.sandbox:allow-same-origin` | storage enabled (`setDomStorageEnabled`) | default data store |
| `webview:m.sandbox:allow-popups` | `setSupportMultipleWindows`, `onCreateWindow` | `createWebViewWith…` of the `WKUIDelegate` |
| `webview:m.sandbox:allow-downloads` | a `DownloadListener` | `WKDownload` |
| `webview:m.sandbox:allow-modals` | `onJsAlert` / `onJsConfirm` / `onJsPrompt` | `runJavaScriptAlertPanel…` of the `WKUIDelegate` |
| `webview:m.allow:camera`, `webview:m.allow:microphone` | `onPermissionRequest` (`RESOURCE_VIDEO_CAPTURE`, `RESOURCE_AUDIO_CAPTURE`) | `requestMediaCapturePermissionFor…` |
| `webview:m.allow:autoplay` | `setMediaPlaybackRequiresUserGesture(false)` | `mediaTypesRequiringUserActionForPlayback = []` |
| `webview:m.allow:fullscreen` | `onShowCustomView` | `isElementFullscreenEnabled` |

A native client that cannot apply a capability (some features have no switch, or need a new
webview) grants only what it can apply.

### Example: a call widget

A call widget requests, before `m.notify_ready`:

```
webview:m.allow:camera
webview:m.allow:microphone
webview:m.allow:display-capture
webview:m.allow:autoplay
webview:m.allow:fullscreen
```

The host asks the user, who approves; the widget gets `m.update_capabilities` with them, and the
client loads the widget again with
`allow="autoplay 'src'; camera 'src'; display-capture 'src'; fullscreen 'src'; microphone 'src'"`. The
second load requests the same, gets them at once, and sends `m.notify_ready`. The next time the user
opens the widget, the client remembers them and loads it with them right away.

### On the web

 * The `sandbox` attribute is the base tokens plus every granted `sandbox` token.
 * The `allow` attribute lists every granted feature with the allowlist `'src'`: the feature is
   delegated to the origin of the iframe's `src` only, not to a page of another origin the widget
   navigates to (`camera 'src'; microphone 'src'`); a page the widget embeds gets it only if the
   widget delegates it in turn (as a compatibility wrapper does). Without a granted feature it is
   empty, which delegates nothing.
 * A client builds the attributes from the tokens itself, after checking each value again; it never
   copies a string of the widget into them.

### Widgets of the existing widget API

A widget written for today's clients runs through a widget API message wrapper (MSC4412,
"Backwards compatibility"). Such widgets expect the webview Element Web gives every widget
(MSC4411, "Widgets of the existing widget API"). The wrapper requests that set for itself when it
starts:

```
webview:m.sandbox:allow-forms             webview:m.allow:microphone
webview:m.sandbox:allow-popups            webview:m.allow:camera
webview:m.sandbox:allow-popups-to-escape-sandbox
webview:m.sandbox:allow-same-origin       webview:m.allow:encrypted-media
webview:m.sandbox:allow-scripts           webview:m.allow:autoplay
webview:m.sandbox:allow-presentation      webview:m.allow:display-capture
webview:m.sandbox:allow-downloads         webview:m.allow:clipboard-write
                                          webview:m.allow:clipboard-read
                                          webview:m.allow:fullscreen
```

A client that wants these widgets to keep working grants the set without asking and builds the
wrapper's webview with it from the start, so the request needs no prompt and no reload. The wrapper
gives the legacy widget's iframe the same attributes, constant (a legacy widget cannot request
webview capabilities), except `allow-same-origin` for a legacy widget of the wrapper's own origin.

## Potential issues

 * **Reloads lose state.** A widget that requests a webview capability after it has shown itself is
   reloaded when the user approves. Widgets should request what they know they need before
   `m.notify_ready`, and keep state they need across a reload (in their own storage, or in the room).
   An API to change the webview without a reload does not exist on the web.
 * **Widgets lose rights.** Widgets of MSC4411 that relied on the old default set (camera,
   microphone, popups) have to request them. Widgets without the widget API keep the strict default
   for good, unless the user grants more by hand.
 * **More prompts.** A call widget adds five lines to its permission prompt. Clients can group them
   ("use your camera, microphone and screen") and remember the answer.
 * **The browser asks too.** The camera, the microphone and the screen are still behind the
   browser's own prompt, which names the client, not the widget. A webview capability only makes the
   browser ask at all.
 * **Features with the allowlist `*`** (`picture-in-picture`, `sync-xhr`, ...) are enabled in an
   iframe without an `allow` attribute naming them. A strict client lists them with `'none'`; this
   MSC does not require it.

## Alternatives

 * **A field in the state event** (MSC4411, "Add iframe capabilities to this (state event) MSC"):
   whoever adds the widget would have to know what it needs, the field gets out of sync with the
   widget, room state would decide what every member's webview grants, and a widget could not ask
   when the need arises. Rejected.
 * **Abstract names** (`webview:m.camera`, `webview:m.popups`) instead of the web's tokens: easier
   for native clients, but every new web feature would need an MSC before a widget could request it,
   and web clients (most widget hosts) would need a mapping table. The web's names are an existing,
   maintained vocabulary; native clients map them (see the table above).
 * **Widget actions** (`m.request_webview { sandbox, allow }`) with their own answer: a second
   permission system next to MSC4412's capabilities, with its own prompt, remembering and
   revocation. The capabilities already do all of it.
 * **Live changes without a reload**: changing `sandbox` or `allow` on a loaded iframe applies only
   to the next navigation, so the iframe has to load again either way.

## Security considerations

 * The strict default (MSC4411) is what makes this matter: without a grant a widget can run scripts
   in its own origin and nothing else. Each grant is a decision of the user or of the client's
   policy, never of whoever added the widget to the room.
 * `allow-scripts` together with `allow-same-origin` lets a page remove its own sandbox; that is
   harmless only for a page of another origin than the client's. Clients refuse widgets of their own
   origin (MSC4411).
 * `allow-top-navigation` and its variants are never granted, whatever the user approves.
 * `allow-popups-to-escape-sandbox` lets the widget open pages without its restrictions;
   `allow-modals` lets it block the client's window with a dialog. Clients should mark both in the
   prompt.
 * Values are single tokens of a fixed alphabet, and the client builds the attributes itself, so a
   capability cannot inject a second token, an allowlist (`camera *`) or another attribute.
 * Features are delegated with `'src'`: a page of another origin the widget navigates to does not
   get them, and a page it embeds only if the widget delegates them itself.
 * A compatibility wrapper holds the legacy set on behalf of the legacy widget (MSC4412, "Security
   considerations": hosts should only use a wrapper they trust).

## Unstable prefix

While this MSC is not part of the spec, implementations use `org.matrix.mscXXXX` instead of `m`
after the source:

| Stable                        | Unstable                                       |
|-------------------------------|------------------------------------------------|
| `webview:m.sandbox:<token>`   | `webview:org.matrix.mscXXXX.sandbox:<token>`   |
| `webview:m.allow:<feature>`   | `webview:org.matrix.mscXXXX.allow:<feature>`   |

The source `webview` is not prefixed (MSC4412, proposed "Capability sources").

## Dependencies

[MSC4412](https://github.com/matrix-org/matrix-spec-proposals/pull/4412) and its proposed
[capability sources](../msc4412/capability-sources.md);
[MSC4411](https://github.com/matrix-org/matrix-spec-proposals/pull/4411) with its proposed
[strict webview defaults](../msc4411/strict-webview-defaults.md).
