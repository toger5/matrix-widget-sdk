# MSC4411: strict webview defaults, more only through webview capabilities

- **Target:** [MSC4411](https://github.com/matrix-org/matrix-spec-proposals/pull/4411), `proposals/4411-widget-state-event.md`
- **Base:** `5fb0ac8c877820e89c84a955fa33d663c7adb42b`
- **Status:** draft
- **Implemented here:** the strict default and the legacy set: the driver's `webview_attributes`
  and `WebviewPolicy` (`crates/widget-host-driver/src/webview.rs`); the widget host builds every
  iframe from them (`packages/widget-host/src/app/AppRoot.tsx` `WidgetIframes`,
  `src/app/runtime/widgetRuntime.ts`, `src/lib/webview.ts`) and grants a legacy widget's compat
  wrapper the legacy set without asking (`src/widgetStateEvent.ts` `LEGACY_WEBVIEW`). Widgets of the
  client's own origin are refused by `embed_url_problem` / `WidgetDefinition::embed`
  (`crates/widget-host-driver/src/widget_url.rs`, `EmbedOptions`); the widget host passes
  `location.origin`, with one deliberate exception for a developer tool: the test widgets it ships
  itself (`ownWidgetDirs` in `packages/widget-host/src/lib/widgetEvents.ts`, the dev site serves them
  from the host's origin). The compat wrapper gives its inner iframe the legacy set, without
  `allow-same-origin` for a legacy widget on its own origin
  (`packages/widget-compat-wrapper/src/wrapper.ts` `innerIframe`). The webview capabilities
  themselves: [`../new/webview-capabilities.md`](../new/webview-capabilities.md); the capability
  source they need: [`../msc4412/capability-sources.md`](../msc4412/capability-sources.md).

## Why

MSC4411 asks clients to load every widget with what Element Web gives every widget today: forms,
popups, downloads, presentation, camera, microphone, screen capture, clipboard. Most widgets need
none of it (a poll, a notes widget), yet each of them can use the camera and read the clipboard
(the browser still prompts for some of it, but the prompt names the client, not the widget). And
the set is fixed: a widget that needs something else (fullscreen, geolocation) cannot get it.

The proposal already lists the alternatives: a field in the state event, or asking over the widget
API. Asking is better: the widget knows what it needs, nothing in the room can get out of sync with
it, and the user decides with the capability prompt the client has anyway. That is the new
[webview capabilities](../new/webview-capabilities.md) MSC; this change makes MSC4411's default the
strict one it builds on.

The default also left a gap: `allow-scripts allow-same-origin` is only safe for pages of another
origin than the client's. A widget whose URL is a page of the client's own origin would run with the
client's origin, with access to its window, storage and logins.

## Change

"Default webview capabilities" (same heading, so the existing links keep working):

- Every widget starts strict: `sandbox="allow-scripts allow-same-origin"`, an empty `allow`. More only
  through webview capabilities the widget holds (MSCXXXX); a client MUST NOT give more (widgets of
  the existing widget API aside, below).
- Why each token is in the default: scripts; `allow-same-origin` because an opaque origin has no
  storage, makes the widget's own requests cross-origin, and can only be addressed with
  `postMessage(…, "*")`, which MSC4412 forbids. The pair is harmless for pages of other origins.
- Native clients: the equivalent (scripts and storage of the widget's origin, nothing else).
- A widget of the client's own origin: clients MUST NOT load it with `allow-same-origin` and SHOULD
  refuse it. Pages that are part of the client (a bundled compatibility wrapper) are not widgets in
  this sense. Clients SHOULD be served from an origin that serves no widgets.
- Still: never the top navigation, whatever the widget requests; the platform's own prompts stay;
  these settings grant no widget API permissions.
- New subsection "Widgets without the widget API": they keep the strict default; a client may let
  the user grant more (developer tools), applied on the next load.
- New subsection "Widgets of the existing widget API": Element Web's set (the old default, plus
  `allowfullscreen`). A client that runs them through a message wrapper grants the wrapper this set
  as webview capabilities without asking; the wrapper gives its inner webview the same, but never
  `allow-same-origin` to a widget of its own origin. A client that supports them natively may load
  them with the set.

"Alternatives", "Add iframe capabilities to this (state event) MSC": the old default is described as
an earlier version; the state event field is rejected with reasons (whoever sets up the widget would
have to know what it needs, it gets out of sync, room state would decide what every member's webview
grants, and it cannot ask when the need arises); the postmessage API is the chosen way (MSCXXXX).

"Security considerations": two bullets, the strict default (a decision of the user, not of whoever
added the widget) and the same-origin rule.

"Potential issues": a new subsection "Strict webview defaults": widgets that move to `m.widget` lose
what they had until they request it; widgets without the widget API keep the strict default;
widgets behind a wrapper keep what they had.

````diff
--- a/proposals/4411-widget-state-event.md
+++ b/proposals/4411-widget-state-event.md
@@ -97,30 +97,76 @@
 
 ### Default webview capabilities
 
-Until a dedicated capability negotiation is specified (see `Alternatives`/
-`Add iframe capabilities to this (state event) MSC`), clients SHOULD load every widget with the following default
-set of capabilities. This matches what is deployed in practice today (Element Web) and is sufficient for the
-existing widget ecosystem (e.g. Element Call, Neoboard).
+Clients load every widget in a strictly restricted webview. A widget gets more only by asking for it:
+it requests webview capabilities over the widget API
+([MSCXXXX: Webview capabilities for widgets](https://github.com/matrix-org/matrix-spec-proposals/pull/XXXX),
+on top of [MSC4412](https://github.com/matrix-org/matrix-spec-proposals/pull/4412)), the client (usually
+the user) decides, and the client applies what it granted to the widget's webview. The widget knows what
+it needs, so nothing has to be declared in the state event, and nothing can get out of sync with it.
 
-Web clients SHOULD use:
+Web clients SHOULD load a widget with:
 ```html
+<iframe sandbox="allow-scripts allow-same-origin" allow=""></iframe>
+```
+and MUST NOT give it more than that and the webview capabilities it holds (see MSCXXXX), except for
+widgets of the existing widget API (see below).
+
+ - `allow-scripts`: practically every widget runs scripts.
+ - `allow-same-origin`: the widget keeps its own origin. Without it the widget's origin is opaque: it has
+   no storage (`localStorage`, IndexedDB, cookies), its requests to its own server are cross-origin
+   requests, and the client can only address it with `postMessage` and the target origin `*`, which
+   [MSC4412](https://github.com/matrix-org/matrix-spec-proposals/pull/4412) forbids. The combination
+   of `allow-scripts` and `allow-same-origin` lets a page lift its own sandbox, which is harmless for a
+   page of another origin than the client's: it gets no more than its own origin. A page of the client's
+   origin is a different matter, see below.
+ - An empty `allow` attribute delegates no Permissions Policy feature: no camera, microphone, screen
+   capture, clipboard, fullscreen, autoplay, ...
+
+Native clients SHOULD give a widget's webview the equivalent: running scripts and persistent storage of
+the widget's own origin, and nothing else (no camera or microphone, no popups or links that leave the
+webview, no downloads, ...) until the widget holds the matching webview capability.
+
+A widget whose `url` has the client's own origin would not be sandboxed from the client with
+`allow-same-origin`: it could reach the client's window, its storage and its logins. Clients MUST NOT
+load such a widget with `allow-same-origin`, and SHOULD refuse to load it at all (without
+`allow-same-origin` it does not work, see above). Pages that are part of the client itself, for example
+a compatibility wrapper the client bundles (MSC4412, "Backwards compatibility"), are not widgets of a
+room in this sense. Clients SHOULD be served from an origin that serves no widgets.
+
+Clients MUST NOT allow a widget to navigate the client itself (`allow-top-navigation` and its variants on
+the web), whatever the widget requests.
+Granting a capability in the webview does not bypass the platform's own user prompt (e.g. for camera or
+microphone access).
+
+These webview settings do not grant Matrix Widget API permissions.
+
+#### Widgets without the widget API
+
+A widget that does not use the widget API (`uses_widget_api` of MSC4412 is `false` or missing) cannot
+request anything and keeps the strict default. Clients MAY let the user grant it more (for example in
+developer tools); a grant applies when the widget is loaded again.
+
+#### Widgets of the existing widget API
+
+Widgets written for today's clients (`im.vector.modular.widgets`, the existing widget API) expect the
+webview Element Web gives every widget:
+
+```html
 <iframe
   sandbox="allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts
            allow-presentation allow-downloads"
   allow="microphone; camera; encrypted-media; autoplay; display-capture; clipboard-write; clipboard-read"
+  allowfullscreen
 ></iframe>
 ```
 
-Native clients SHOULD grant the equivalent capabilities through their platform's webview permission mechanism:
-running scripts, persistent storage, forms, opening popups/external links, downloads, presentation, microphone,
-camera, encrypted media, media autoplay, screen capture and clipboard read/write.
+A client that loads them through a widget API message wrapper (see `Potential issues`/
+`Widget API message wrapper`) SHOULD grant the wrapper these as webview capabilities without asking, as
+it did before, and the wrapper gives its inner webview the same. The wrapper's own origin is often the
+client's: a wrapper MUST NOT give a widget of its own origin `allow-same-origin`. A client that keeps
+supporting these widgets natively (MSC4412, "Backwards compatibility") MAY load them with these
+attributes.
 
-Clients MUST NOT allow a widget to navigate the client itself (e.g. `allow-top-navigation`).
-Granting a capability in the webview does not bypass the platform's own user prompt (e.g. for camera or
-microphone access); clients MAY additionally prompt the user before granting sensitive capabilities.
-
-These webview settings do not grant Matrix Widget API permissions.
-
 ### Remove `$matrix_widget_id`
 [MSC2774](https://github.com/matrix-org/matrix-spec-proposals/pull/2774) introduced `$matrix_widget_id` and was
 merged. This proposal removes the template variable concept
@@ -211,21 +257,24 @@
 request `notifications`; this would need to be proxied by the client through the postmessage API
 ([MSC4412](https://github.com/matrix-org/matrix-spec-proposals/pull/4412)).
 
-The default set of capabilities clients use today is defined in `Proposal`/`Default webview capabilities`.
+An earlier version of this MSC recommended loading every widget with the set Element Web uses (now
+`Proposal`/`Default webview capabilities`/`Widgets of the existing widget API`), until a dedicated
+negotiation exists. Every widget would have had the camera, the microphone and the clipboard, whether it
+needs them or not.
 
-The base state event could be extended with a field listing the capabilities the widget needs. To stay platform
-independent this should use abstract capability names (camera, microphone, screen capture, clipboard, fullscreen,
-downloads, popups, ...) rather than raw HTML tokens, which clients map to their platform's mechanism.
-A client can then prompt the user based on the requested capabilities.
+The base state event could be extended with a field listing the capabilities the widget needs. This is
+rejected:
+ - The user who sets up the widget would have to know which capabilities the widget needs, and the field
+   gets out of sync with the widget when the widget changes.
+ - Whoever may send state events to the room would decide what every member's webview grants.
+ - A widget can only declare what it needs before it runs, not when it needs it (a whiteboard that asks
+   for the clipboard when the user first pastes).
 
-Alternatively, this can be done via the postmessage API. This has the advantage that the user who sets up the
-widget does not need to know which capabilities are required: the widget implementation has full control over
-what it requests.
+The capabilities are requested over the postmessage API instead
+([MSCXXXX](https://github.com/matrix-org/matrix-spec-proposals/pull/XXXX)): the widget implementation has
+full control over what it requests and when, and the client decides with the widget API's capability
+negotiation, which it has anyway.
 
-Either way, this is left to a follow-up MSC. Such an MSC could ask clients to prompt users if a widget is set up
-without any capability declaration. Those widgets then get the default set of capabilities (see
-`Default webview capabilities`) for backwards compatibility, but users get prompted to update their widget.
-
 ## Security considerations
 
 The core of this proposal is that room administrators can now embed arbitrary widgets in Matrix rooms, and as
@@ -236,6 +285,12 @@
  - Clients should take all reasonable care to fully isolate the widget frame from the parent client. In
    browser contexts this would mean ensuring sufficient use of `sandbox` as well as tight cross-site scripting
    policies so that the widget could not, for example, sniff out the user's credentials.
+ - Widgets start with the strict default (`Proposal`/`Default webview capabilities`): what a widget can do
+   in the webview beyond running scripts is a decision of the user (or the client's policy), not of whoever
+   added the widget to the room.
+ - Every widget webview keeps its own origin (`allow-same-origin`). A page of the client's own origin would
+   therefore share the client's origin, its storage and its logins: clients refuse such widgets and should
+   be served from an origin that serves no widgets.
 
  See also: _Add iframe capabilities to this (state event) MSC_
 
@@ -331,6 +386,13 @@
 clients that do the migration automatically will make sure old widgets are still usable without
 clients maintaining two implementations.
 
+### Strict webview defaults
+
+Widgets that move to `m.widget` lose the webview capabilities they had without asking (camera,
+microphone, popups, downloads, ...) until they request them over the widget API. Widgets without the
+widget API keep the strict default. A widget that runs through a widget API message wrapper keeps what it
+had (`Proposal`/`Default webview capabilities`/`Widgets of the existing widget API`).
+
 ## Unstable prefix
 
 ### `im.vector.modular.widgets` and `org.matrix.msc4411.widget`
````

## Open questions

- Should the strict default leave out `allow-same-origin` too, and the widget request it? Without it
  almost no widget works (no storage, and the host could not address it without `postMessage(…, "*")`),
  so it is part of the base here.
- Features whose default allowlist is `*` (`picture-in-picture`, `sync-xhr`, ...) stay enabled with an
  empty `allow`. Should a client list them with `'none'`, or should the MSC name the features a strict
  webview must disable?
- Is "the client's own origin" the right line, or should a client refuse widgets of the same *site*
  (another sub-domain), which can share cookies with it?
