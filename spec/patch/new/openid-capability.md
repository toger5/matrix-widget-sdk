> **Draft in matrix-widget-sdk.** Status: draft. Implemented here: the action and its response
> (`crates/widget-actions/src/actions/widget/get_openid.rs`), single use in the host driver
> (`crates/widget-host-driver/src/driver/requests.rs`, `WidgetHostDriver::set_single_use`), the
> widget SDK's `request_openid_token` (`crates/widget-base-sdk/src/client.rs`), legacy widgets
> through the compat wrapper (`packages/widget-compat-wrapper/src/bridge.ts`), the widget host's
> capability prompt (`packages/widget-host`).
> Related patches: [`../msc4412/capability-lifetimes.md`](../msc4412/capability-lifetimes.md)
> (limited grants). Remove this block when opening the MSC.

# MSCXXXX: OpenID tokens for widgets as a capability

A widget often has to prove to its own server who the user is: a call widget asks its service for
a media token, an integration asks its backend for the user's settings. The widget's URL can say
anything, so it needs a credential the server can check. [MSC1960](https://github.com/matrix-org/matrix-spec-proposals/pull/1960)
gives widgets an OpenID token of the user's homeserver
([`POST /_matrix/client/v3/user/{userId}/openid/request_token`](https://spec.matrix.org/latest/client-server-api/#openid)),
which the server checks with the homeserver's `/openid/userinfo`.

MSC1960 has its own consent step. `get_openid` is answered with `state: "request"` while the user
is asked, and the outcome follows later as a host request, `openid_credentials`, that names the
original request. This is a second permission system next to the capabilities of
[MSC4412](https://github.com/matrix-org/matrix-spec-proposals/pull/4412): a second prompt, a second
asynchronous protocol, a host action that needs no capability, and a response with three shapes.
MSC4412 already has the asynchronous consent step: `m.request_capabilities`, answered by
`m.update_capabilities`. With [limited grants](../msc4412/capability-lifetimes.md) it can also
express "for this one token".

This MSC makes OpenID a capability of MSC4412 and drops the second protocol.

## Proposal

### `m.get_openid` (widget -> host)

The widget asks for an OpenID token. The request is empty. The response is the body of the
homeserver's `POST /_matrix/client/v3/user/{userId}/openid/request_token` response:

```json5
{
  source: "widget",
  action: "m.get_openid",
  request_id: "1234",
  request: {},
  response: {
    access_token: "SomeT0kenHere",
    token_type: "Bearer",
    matrix_server_name: "example.com",
    expires_in: 3600,
  },
}
```

 * It requires the capability `widget:m.get_openid`. Without it the host answers with
   `m.missing_capability`.
 * While the widget holds the capability, the host answers at once, with a token or with an error
   (for example `m.unknown` when the homeserver fails). There is no pending state and no later
   message.

### The capability `widget:m.get_openid`

Granting the capability is the user's consent to hand out tokens. It is requested and granted like
any other capability (`m.request_capabilities`, `m.update_capabilities`), so a host that asks the
user does it in its usual capability prompt.

 * A host SHOULD grant it for one use only (a [limited grant](../msc4412/capability-lifetimes.md)):
   the `m.get_openid` that uses it ends the grant, and the host sends `m.update_capabilities`
   without it after the response. Every token is then a decision of the user.
 * A host MAY grant it for longer when the user chose to allow it always for this widget, or by
   policy (for example for widgets the client ships itself). Remembering it means granting it again
   without asking whenever the widget requests it; each grant is still for one use.
 * A widget that needs a token and does not hold the capability requests it, waits for the next
   `m.update_capabilities` after the host acknowledged that request (an earlier update answers
   something else), and sends `m.get_openid` if it was granted. A widget SDK can do this in one
   call. The widget does not need to know that the grant is limited: it learns that the
   capability is gone from the update.

### Widgets of the existing widget API

This replaces MSC1960 for widgets that use MSC4412. MSC1960's `get_openid` and
`openid_credentials` stay what they are for widgets of the existing widget API ("legacy widgets").
A compatibility wrapper (MSC4412, "Backwards compatibility") translates for them: on the legacy
`get_openid` it answers `state: "allowed"` with the token while it holds `widget:m.get_openid`.
Otherwise it answers `state: "request"`, requests the capability (once for every legacy request
that waits), and sends each waiting request `openid_credentials`: `allowed` with the token, or
`blocked` if the capability was not granted. A wrapper does not request the capability up front
just because legacy widgets could always ask: that would turn a prompt per token into one approval
for all tokens.

## Potential issues

 * A widget that needs a token at every start (a call widget per call) makes the user decide at
   every start, unless the user allows it always. That is the point of the limit, but hosts should
   offer "always" in the prompt.
 * The response changes from MSC1960's (`state` and the token fields) to the token alone. This only
   concerns widgets that use MSC4412; a wrapper keeps legacy widgets working.
 * A widget that waits for "the next `m.update_capabilities`" as the answer reads an update the host
   sent for another reason (a revocation) as a refusal. It can request again.

## Alternatives

 * **Keep MSC1960's flow behind the capability** (as early implementations of MSC4412 did): the
   capability allows asking, and the user is asked again per token in a second prompt, answered
   by `openid_credentials`. Two prompts for one decision, and a host action without a capability.
 * **The capability without a limit**: one approval hands out every future token without the user
   noticing. A token proves the user's identity to whatever server the widget sends it to.
 * **Tell the widget the limit** in `m.update_capabilities` (for example `"once"`): the widget could
   explain the next prompt, but it has to handle the update anyway, and the host loses the freedom
   to change its policy without a protocol change.
 * **A host action that pushes a token** when the capability is granted: the widget gets a token
   whether or not it still needs one, and cannot ask for a fresh one when the old one expired.

## Security considerations

 * An OpenID token lets any server that receives it learn the user's Matrix ID from the homeserver
   (`/openid/userinfo`) until it expires. Granting `widget:m.get_openid` discloses the user's
   identity to the widget's servers; hosts should present it as such ("proves who you are to other
   servers") and ask by default.
 * A one-use grant ends when the host accepts the `m.get_openid` that uses it, before the token is
   fetched, so a widget cannot get two tokens for one approval by sending requests in parallel.
 * The token is a credential: hosts, wrappers and widget SDKs should not write it to logs.
 * A compatibility wrapper sees the tokens of the legacy widget it wraps (MSC4412, "Security
   considerations": hosts should only use a wrapper they trust).

## Unstable prefix

While this MSC is not part of the spec, implementations use `org.matrix.mscXXXX` instead of `m`:

| Stable                | Unstable                               |
|-----------------------|----------------------------------------|
| `m.get_openid`        | `org.matrix.mscXXXX.get_openid`        |
| `widget:m.get_openid` | `widget:org.matrix.mscXXXX.get_openid` |

MSC1960's `get_openid` and `openid_credentials` (without a namespace) are the actions of the
existing widget API and are not accepted under MSC4412.

## Dependencies

[MSC4412](https://github.com/matrix-org/matrix-spec-proposals/pull/4412) and its proposed
[limited grants](../msc4412/capability-lifetimes.md). The token and its endpoint are in the spec
(client-server API, "OpenID"); MSC1960 is merged.
