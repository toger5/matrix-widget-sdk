# MSC4412: limited grants of a capability (one use, a period of time)

- **Target:** [MSC4412](https://github.com/matrix-org/matrix-spec-proposals/pull/4412), `proposals/4412-widget-base-postmessage-api.md`
- **Base:** `1794f40325a449eed21dcbfce53efc80e89f56f6`
- **Status:** draft
- **Implemented here:** single use in the host driver: `WidgetHostDriver::set_single_use`
  (default: `widget:…get_openid`) and `DriverSnapshot.single_use`
  (`crates/matrix-widget-host-driver/src/driver/mod.rs`); the check and the use under one lock, the update
  after the reply (`driver/requests.rs` `handle_request`); tests `openid_is_a_one_use_capability`,
  `a_use_is_a_request_that_passed_the_check_whatever_its_result`,
  `an_auto_approved_single_use_capability_is_granted_again_per_request`,
  `using_a_capability_up_while_a_question_is_open` in `driver/tests.rs`; two requests in flight at
  once: `packages/widget-host/test/jsSdkBackend.test.ts`. Time limits are not in
  the driver (it has no clock): the platform starts a timer and calls `revoke_capabilities`. The
  widget host does not remember a single-use approval
  (`packages/widget-host/src/app/runtime/widgetRuntime.ts` `answerCapabilities`). The first user is
  OpenID, [`../new/openid-capability.md`](../new/openid-capability.md). The hunks share no line
  with [`merge-capability-requests.md`](merge-capability-requests.md); both apply, in either order.

## Why

Some capabilities let a widget take something it can keep: an OpenID token proves the user's
identity to the widget's server for as long as the token lives. A user who approves such a
capability once has, under MSC4412 as it is, approved every token the widget will ever ask for.
MSC1960 therefore asks the user per token, outside the capability system (a second prompt and a
second asynchronous protocol). The capability system can do this itself if a host may limit a grant.

MSC4412 already lets the host take capabilities away at any time ("Relinquishing"), so a limit is
expressible without a new action. What is missing: that a host may limit a grant, what counts as a
use, that the host announces the end of a grant, and what remembering a limited grant means.

## Change

In "Capabilities", a new subsection **Limited grants** after "Evolving actions":

- A host MAY limit a grant per capability, to a number of uses or a period of time; it is the host's
  policy (example: one use for an action that hands out a credential).
- A use is an action the host accepted under the capability (it passed the check), whatever its
  result. The host takes a used-up capability away as it accepts the action, so two actions sent at
  once cannot both use the last use.
- When a grant ends, the host MUST send `m.update_capabilities` without the capability, after the
  response to the action that used it up.
- The widget requests the capability again for the next use; the host decides again.
- A client remembers a limited grant only if the user chose to allow it always; remembering means
  granting it again, without asking, on every request, each grant limited as before.
- No action carries the limit; the widget learns what it holds from `m.update_capabilities` only.

In `m.update_capabilities`, a third bullet next to "Granting" and "Relinquishing": **Ending a
limited grant**, with the order (after the response).

In "Potential issues": the widget learns of the end only from the next update (an action in between
gets `m.missing_capability`, and a revocation can be read as a refusal by a widget that waits for the
next update), and a user asked per use may be asked often ("always" is the way out).

In "Security considerations": a grant ends when the host accepts the action, not when the widget
hears of it, so parallel actions cannot use a one-use capability twice; hosts should grant the
capability of an action that hands out a credential the widget can pass on to any server (an OpenID
token) for one use, unless the user chose otherwise.

````diff
--- a/proposals/4412-widget-base-postmessage-api.md
+++ b/proposals/4412-widget-base-postmessage-api.md
@@ -251,7 +251,29 @@
 
 This is the only versioning mechanism of the widget API. The actions themselves do not carry a
 version and no further version negotiation is required.
+
+#### Limited grants
 
+A host MAY limit the grant of a capability: to a number of uses, or to a period of time. Which
+grants are limited, and how, is the host's policy, decided per capability. For example, a host can
+grant the capability of an action that hands out a credential for one use only, so that the user
+decides about every credential.
+
+ * A **use** is an action the host accepts under the capability: an action that passed the
+   capability check, whatever its result. The host takes a used-up capability away as it accepts
+   the action, so that two actions sent at once cannot both use the last use.
+ * When a grant ends, used up or expired, the host MUST send
+   [`m.update_capabilities`](#mupdate_capabilities-host---widget) without the capability. If an
+   action used it up, the update is sent after the response to that action.
+ * To use the capability again, the widget requests it again with
+   [`m.request_capabilities`](#mrequest_capabilities-widget---host), and the host decides again.
+ * A client that remembers what was allowed before remembers a limited grant only if the user chose
+   to allow it always. Remembering it means granting it again, without asking, whenever the widget
+   requests it; every such grant is limited as before.
+
+No action carries the limit. The widget learns what it holds only from `m.update_capabilities`, as
+for any other change.
+
 ### Core actions
 
 Implementations of this MSC only need to support `m.notify_ready`, `m.request_capabilities` and
@@ -329,6 +351,8 @@
    sends an update that contains the previously allowed capabilities and the new ones.
  * **Relinquishing:** to remove capabilities from the widget (for example because the user revoked
    a permission), the host sends an update with a reduced `allowed` list.
+ * **Ending a limited grant:** when a [limited grant](#limited-grants) ends, the host sends an update
+   without the capability, after the response to the action that used it up.
 
 ### State event
 
@@ -392,6 +416,13 @@
    is why widgets should only move to this MSC once hosts support it.
  * A compatibility wrapper has to request the capabilities it needs for itself in addition to the
    ones of the legacy widget, so the user can be prompted twice.
+ * A widget learns that a [limited grant](#limited-grants) has ended only from the next
+   `m.update_capabilities`. An action it sends before that update arrives is answered with
+   `m.missing_capability`. A widget that requests the capability again and takes the next update as
+   the answer reads an update the host sent for another reason (a revocation) as a refusal.
+ * A user who is asked for every use of a capability may be asked often, for example by a widget
+   that needs a credential at every start. Allowing it always (see
+   [Limited grants](#limited-grants)) is the way out the host offers.
 
 ## Alternatives
 
@@ -471,6 +502,12 @@
 behalf. Hosts should therefore only use a wrapper they trust. They SHOULD bundle the wrapper they
 use themselves.
 
+A [limited grant](#limited-grants) ends when the host accepts the action that uses it up, not when
+the widget hears about it, so a widget cannot use a one-use capability twice by sending two actions
+at once. Hosts should grant the capability of an action that hands out a credential the widget can
+pass on to any server (such as an OpenID token, which proves the user's identity to that server) for
+one use, unless the user chose otherwise.
+
 ## Unstable prefix
 
 While this MSC is not part of the spec, implementations use `org.matrix.msc4412` instead of `m` as
````

## Open questions

- Should the host tell the widget the limit (`once`, an expiry) in `m.update_capabilities`? A widget
  could then skip the request that will be refused, and show "you will be asked again". Left out:
  the widget has to handle the update anyway, and the host stays free to change its policy.
- Should the update after a use be a MUST (as written) or a SHOULD? Without it the widget learns of
  the end only from the next `m.missing_capability`.
- Is "allow always" the only form of remembering a limited grant, or may a client remember it for a
  period (for example for one call)?
