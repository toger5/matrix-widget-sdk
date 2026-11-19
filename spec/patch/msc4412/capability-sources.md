# MSC4412: capability sources defined by other MSCs

- **Target:** [MSC4412](https://github.com/matrix-org/matrix-spec-proposals/pull/4412), `proposals/4412-widget-base-postmessage-api.md`
- **Base:** `1794f40325a449eed21dcbfce53efc80e89f56f6`
- **Status:** draft
- **Implemented here:** the source `webview` (`crates/matrix-widget-actions/src/capabilities.rs`,
  `Capability::WebviewSandbox` / `WebviewAllow`) and the driver's policy for it
  (`crates/matrix-widget-host-driver/src/webview.rs`); a string of any other source is
  `Capability::Other`. The first other source: [`../new/webview-capabilities.md`](../new/webview-capabilities.md).
  The hunks share no line with [`merge-capability-requests.md`](merge-capability-requests.md) and
  [`capability-lifetimes.md`](capability-lifetimes.md); the three apply in any order.

## Why

MSC4412's capability format says that every capability maps to exactly one action, and its
`source` is who sends that action. A widget also needs permissions that are about no action: the
browser permissions of the webview it runs in (camera, microphone, popups, ...), which a client
applies to the iframe. They are negotiated best like any other capability (the widget requests,
the host decides and tells the widget what it holds), so they need capability strings, and the
rule "one capability, one action" has to make room for them without loosening it for the actions.

## Change

In "Capability format":

- The first principle reads "every capability of the sources `widget` and `host` maps to exactly
  one action", with a pointer to the new subsection.
- The `source` row of the table: "Other MSCs can add sources."
- A new subsection **Capability sources** before "Evolving actions": other MSCs can define sources
  for permissions that are about no action, negotiated the same way. Such a capability has the same
  shape (`source:<namespace>.<name>[:data]`), the defining MSC says what name and data mean, and the
  namespace follows "Action naming" (`m`, or the defining MSC's unstable prefix). A host grants
  nothing of a source it does not know; a widget requests only sources it knows. Sources themselves
  are not namespaced: an MSC that defines one claims the name. The example is `webview:m.allow:camera`
  of the webview capabilities MSC.

In "Unstable prefix": a source defined by another MSC is not prefixed; its capabilities use that
MSC's prefix after the source.

````diff
--- a/proposals/4412-widget-base-postmessage-api.md
+++ b/proposals/4412-widget-base-postmessage-api.md
@@ -206,8 +206,10 @@
 #### Capability format
 
 Capabilities are strings that follow these principles:
- - **Every capability maps to exactly one action.** Actions have only one direction, so a pair of
-   a host -> widget and a widget -> host action needs two capabilities.
+ - **Every capability of the sources `widget` and `host` maps to exactly one action.** Actions
+   have only one direction, so a pair of a host -> widget and a widget -> host action needs two
+   capabilities. (Other MSCs can define sources for capabilities that are about no action, see
+   [Capability sources](#capability-sources).)
  - **One action can have multiple capabilities.** They are told apart by the **modifier** and the
    **capability data**.
  - **Every capability reads as a sentence.** A capability
@@ -220,7 +222,7 @@
 
 | Part                              | Values               | Description                                                                                                         |
 |-----------------------------------|----------------------|---------------------------------------------------------------------------------------------------------------------|
-| `source`                          | `widget` or `host`   | Who sends the action: the `widget` (a request) or the `host` (a subscription).                                      |
+| `source`                          | `widget` or `host`   | Who sends the action: the `widget` (a request) or the `host` (a subscription). Other MSCs can add sources.          |
 | `action`                          | `<namespace>.<name>` | The value of the `action` property of the action (see [Action naming](#action-naming)).                             |
 | `modifier`<br>(optional)          | A descriptive word   | Some actions have a finite set of enum cases that modify the capability. Omitted if there is only one.              |
 | `capability_data`<br>(optional)   | Any string           | Additional constraints that cannot be expressed as a finite list. Its format is defined together with the modifier. |
@@ -237,6 +239,22 @@
    actions, constrained to `m.call.encryption`". `m.send_to_device` has only one variant, so there
    is no modifier.
 
+#### Capability sources
+
+`widget` and `host` are the sources of this MSC, and every capability of theirs is about one action.
+Other MSCs can define further sources, for permissions that are about no action but are negotiated
+the same way, with `m.request_capabilities` and `m.update_capabilities`. For example, the webview a
+widget runs in could get capabilities for its browser permissions
+(`webview:m.allow:camera`, [MSCXXXX](https://github.com/matrix-org/matrix-spec-proposals/pull/XXXX)).
+
+ * A capability of another source has the same shape, `source ":" <namespace>.<name> [":" data]`;
+   the MSC that defines the source says what `<namespace>.<name>` and the data mean. Its
+   `<namespace>` follows [Action naming](#action-naming): `m` once it is in the spec, the unstable
+   prefix of the defining MSC until then.
+ * A host grants nothing of a source it does not know, as it grants no unknown action. A widget
+   requests capabilities of a source only if it knows it.
+ * The source itself is not namespaced. An MSC that defines one claims its name.
+
 #### Evolving actions
 
 The same name under two different namespaces (for example `m.send_event` and
@@ -490,7 +508,8 @@
 the `uses_widget_api` property of the state event are not prefixed.
 
 Actions and capabilities defined by other MSCs use the unstable prefix of the MSC that defines
-them.
+them. A [capability source](#capability-sources) defined by another MSC is not prefixed; its
+capabilities use that MSC's prefix after the source.
 
 ## Dependencies
 
````

## Open questions

- Should a source be namespaced (`org.matrix.mscXXXX.webview:…`) until its MSC is accepted? Here the
  source is a plain word, as `widget` and `host` are, and the namespace after it carries the
  unstable prefix; a clash between two drafts that pick the same word is unlikely and visible.
- Should MSC4412 list the known sources (an appendix, like the error codes), or leave that to the
  MSCs that define them?
