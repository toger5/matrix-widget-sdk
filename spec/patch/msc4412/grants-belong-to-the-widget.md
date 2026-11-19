# MSC4412: grants belong to the widget's origin and URL

- **Target:** [MSC4412](https://github.com/matrix-org/matrix-spec-proposals/pull/4412), `proposals/4412-widget-base-postmessage-api.md`
- **Base:** `1794f40325a449eed21dcbfce53efc80e89f56f6`
- **Status:** draft
- **Implemented here:** the widget host accepts messages only from the driver's
  `WidgetIframe.origin` (`packages/widget-host/src/app/runtime/widgetRuntime.ts`), binds remembered
  capabilities to the iframe URL (`src/lib/capabilityStore.ts`), and accepts a compat wrapper URL
  (`?wrapper=`) only on its own origin (`src/lib/widgetEvents.ts` `wrapperUrl`).

## Why

Three ways a page the user never approved could act with capabilities granted to another one, found
in the widget host of this repository:

1. **Navigation.** The Transport rules identify the widget by the `source` of the message event. A
   widget's `Window` stays the same object when its iframe navigates, so a page of another origin
   that the widget navigates to (a link, a redirect) can send actions that are handled with the
   widget's capabilities. Answers already go to the widget's origin only, but actions like
   `m.send_event` need no answer.
2. **Remembered approvals.** Clients SHOULD remember what was allowed. Remembered per widget (room
   and widget id), they survive a change of the widget's definition: whoever may change the widget's
   state event points an approved widget at another page, and that page gets every remembered
   capability without a prompt. With webview capabilities (`../new/webview-capabilities.md`) that
   includes camera, microphone and screen sharing.
3. **The compatibility wrapper.** The host grants its wrapper what a legacy client granted without
   asking (MSC4411, "Widgets of the existing widget API"). The Security considerations say hosts
   should use a wrapper they trust, but not that nobody else may choose it: this host let a link
   (`?wrapper=`) name any page as the wrapper.

## Change

- **Transport:** a new rule after the `source` rule: the host MUST also check that the message's
  `origin` is the widget's origin and ignore it otherwise, because the `Window` survives navigation.
- **Capabilities, `m.update_capabilities`:** the bullet "the client remembers…" adds that what is
  remembered belongs to the URL the widget was loaded from; when it changes, the client MUST ask
  again.
- **Backwards compatibility:** after the description of the wrapper, the host chooses the wrapper
  itself and MUST NOT let others choose it (a link, a widget's definition), with a pointer to the
  Security considerations, which already explain why.

The hunks touch none of the lines of the other patches in this folder, so they apply in any order.

````diff
--- a/proposals/4412-widget-base-postmessage-api.md
+++ b/proposals/4412-widget-base-postmessage-api.md
@@ -181,6 +181,10 @@
    [`source`](https://developer.mozilla.org/en-US/docs/Web/API/MessageEvent/source) (the widget's
    `Window` object) of the message event. The `origin` alone is not sufficient, as multiple widgets
    may be hosted on the same origin. This ensures widget A cannot impersonate widget B.
+ * The host MUST also check that the `origin` of the message event is the widget's origin, and ignore
+   the message otherwise. The `source` alone is not sufficient: the `Window` stays the same when the
+   widget navigates to a page of another origin, and that page must not act with the widget's
+   capabilities.
  * The host MUST send each action only to the `Window` of the widget it is intended for and MUST set
    the `targetOrigin` to the widget's origin. A `targetOrigin` of `*` MUST NOT be used. This ensures
    widget A does not receive data intended for widget B.
@@ -316,7 +320,9 @@
  - The client allows some capabilities by default in specific cases.
  - The client prompts the user to allow capabilities.
  - The client remembers the capabilities that were allowed before. Clients SHOULD do this, so that
-   users are not prompted again every time the widget starts.
+   users are not prompted again every time the widget starts. What is remembered belongs to the URL
+   the widget was loaded from: when that URL changes (for example because someone changed the
+   widget's definition in the room), the client MUST NOT grant it without asking again.
 
 From then on both sides MUST behave according to the list of allowed capabilities:
 the widget and the host stop sending actions that are not allowed, and the host answers any action
@@ -375,6 +381,9 @@
 defined by this MSC. Instead of embedding a legacy widget directly, the host embeds the wrapper and
 passes it the URL of the legacy widget. The wrapper embeds the legacy widget in an inner iframe and
 relays the actions between the two, translating the action format and the capability negotiation.
+The host chooses the wrapper itself and MUST NOT let others choose it, such as a link to the client
+or a widget's definition: the wrapper holds the capabilities of the legacy widgets it wraps (see
+[Security considerations](#security-considerations)).
 
 The transition is expected to work as follows:
  - Hosts implement this MSC and keep supporting legacy widgets in one of the two ways above.
````

## Open questions

- "The URL the widget was loaded from": for a widget with URL template variables this host binds to
  the template and its `data` (for a legacy widget, the wrapper URL with both in its query), not to
  the filled-in URL. Should the MSC say which one, or leave it to MSC4411?
- Should "remembered" also cover what a client grants a reloaded widget without asking (this host
  carries webview grants across a reload of the same iframe URL only)?
