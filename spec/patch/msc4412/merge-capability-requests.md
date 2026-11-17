# MSC4412: merge capability requests while the user decides, delay the approval

- **Target:** [MSC4412](https://github.com/matrix-org/matrix-spec-proposals/pull/4412), `proposals/4412-widget-base-postmessage-api.md`
- **Base:** `1794f40325a449eed21dcbfce53efc80e89f56f6`
- **Status:** draft
- **Implemented here:** the host driver merges a request into the open question and asks the
  platform about the whole of it, leaving out what the widget holds or gets without asking; one
  `approve_capabilities` answers all requests (`crates/matrix-widget-host-driver/src/driver/requests.rs`
  `request_capabilities`, `driver/mod.rs`, `platform.rs` `on_capabilities_requested`; tests
  `requests_while_one_is_pending_add_up`, `a_request_while_a_question_is_open_never_completes_it`,
  `held_capabilities_are_not_asked_again` in `driver/tests.rs`). The widget host shows one prompt,
  keeps the user's choices, marks what was added "New" and blocks "Approve" for 3 s after the
  prompt appeared or changed (`packages/widget-host/src/views/widget/WidgetView.tsx`
  `CapabilityPrompt`, `src/app/controller.ts` `widget/answerCapabilities`,
  `src/app/runtime/widgetRuntime.ts` `answerCapabilities`, `src/appViewModel.ts`
  `CAPABILITY_APPROVE_DELAY_MS`; e2e `widget.spec.ts` › "a request while the prompt is open joins
  it").

## Why

`m.request_capabilities` is acked at once, and the host answers later with `m.update_capabilities`.
Nothing says what a host does when the widget sends another request while the user still reads the
prompt of the first one. Two prompts for one widget confuse the user, and answering only the
newest one silently drops the rest.

A widget also controls when its requests arrive. It can add capabilities to an open prompt just
before the user clicks "Approve", or make the prompt appear under the pointer at the moment the
user clicks inside the widget. Either way the user approves something they did not read.

## Change

In `m.request_capabilities`, after the paragraph about the ack:

- A widget can request again before the host has decided. The host SHOULD merge such requests
  into the decision that is still open. One `m.update_capabilities` then answers all of them;
  `allowed` is always the full list, so the widget does not need to know which request was
  answered. No action changes.
- A host that asks the user SHOULD show the merged capabilities in the open prompt, keep the
  user's choices and mark what was added; capabilities the widget already holds need no decision.
- It SHOULD NOT accept an approval for a short time (3 seconds recommended) after the prompt
  appeared or changed. Denying stays possible at any time.

In "Security considerations", one paragraph that points to these rules: the widget decides when its
requests arrive, so a host that prompts should make sure the user approves only what they could
read.

````diff
--- a/proposals/4412-widget-base-postmessage-api.md
+++ b/proposals/4412-widget-base-postmessage-api.md
@@ -300,7 +300,20 @@
 The host acks immediately. The ack only acknowledges that the capabilities were requested; it does
 not imply that any of them are granted. The host is in full control of which capabilities it
 grants and when.
+
+A widget can send `m.request_capabilities` again before the host has decided about an earlier
+request, for example while the user still reads a permission prompt. The host SHOULD merge such
+requests into the decision that is still open instead of deciding about each one separately. One
+`m.update_capabilities` then answers all of them; since `allowed` is always the full list, the
+widget does not need to know which request was answered. A host that asks the user:
 
+ * SHOULD show the merged capabilities in the open prompt, keep the choices the user has made, and
+   mark what was added. Capabilities the widget already holds need no decision.
+ * SHOULD NOT accept an approval for a short time (3 seconds is recommended) after the prompt
+   appeared or its capabilities changed, so a widget cannot change what the user approves just
+   before they click, or make the prompt appear under the pointer. Denying stays possible at any
+   time.
+
 #### `m.update_capabilities` (host -> widget)
 
 ```json5
@@ -459,6 +472,10 @@
 [Capabilities](#capabilities), and should only grant capabilities the user or the client's policy
 has agreed to.
 
+A widget decides when its capability requests arrive. Hosts that prompt the user should make sure
+that the user approves only what they could read, see
+[`m.request_capabilities`](#mrequest_capabilities-widget---host).
+
 The host must follow the rules in the [Transport](#transport) section, otherwise one widget could
 impersonate another or receive data intended for another. Widgets must likewise verify that the
 messages they receive come from their host, using the `source` and `origin` of the message event.
````

## Open questions

- Should the delay be a MUST? A host that never prompts (it grants by policy) is unaffected
  either way.
- Is 3 seconds right? Firefox, for example, enables the buttons of its add-on install and download
  dialogs after 1 s (`security.dialog_enable_delay`); the extra time here is for reading a list
  that changed.
