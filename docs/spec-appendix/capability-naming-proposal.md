# Proposal: one capability per action

Status: draft for discussion.

Today's capability names grew one MSC at a time. Each MSC picked its own prefix and shape
(`org.matrix.msc2762.receive.event:<type>`, `town.robin.msc3846.turn_servers`,
`com.beeper.capabilities.receive.room_account_data:<type>`, ...), and several capabilities silently
cover more than one action. This document proposes a naming scheme in which the capability for an
action can be derived from the action's name, in both directions.

## Rules

1. **Every capability maps clearly to one action**
2. **One action can have multiple capabilities** We call those different capability modifiers.
3. **Actions have only one direction** A widget -> host action is always distinct to a host -> widget action
3. **Capabilities for host actions can be interpreted as subscriptions.** Holding one means the host sends that
   action to the widget whenever there is something to send (a new event, changed state, a new
   theme). They use the same pattern as widget actions, with `host` instead of `widget`.
4. **Every capability reads as a sentence.** Action names are verbs, so that
   - `m.widget.<action>.<modifier>:<target>` reads "the widget may *&lt;action&gt;*, *&lt;modifier&gt;*,
     for *&lt;target&gt;*", and
   - `m.host.<action>.<modifier>:<target>` reads "the widget has the capability that the host
     *&lt;action&gt;s*, *&lt;modifier&gt;*, for *&lt;target&gt;*".

   This rule renames some actions, see [Renamed actions](#renamed-actions).

ideas:
 - `m.widget:<action>.<modifier>`
 - More abstract: 3 dimensions: Widget/Host, action, modifier + modifier_data. How we concatinate them is hard to find the "right" solution.
 - no prefix for widget BUT prefixed actions: `widget:org.matrix.mscXXX.myAction:modifier.modifier_data` vs `org.matrix.mscXXX.widget:myAction.modifier`
    - advantage: the action itself will also be called: `org.matrix.mscXXX.myAction` -> reusable string
 - eventType#subtype(m.text)
 - modifiers: delayed, sticky, state?, room (which room... or all rooms)
 - #target: only event type
 - What about an object representations
 - No modifier: NO we dont think its a good idea as this might silently "upgrade widgets" (e.g. old widget without modifier permission autmatically gets more power via update)
 - update vs set for state: update & forward are currently proposed.
   - update: on capabilty approval the host will send current
   - forward: on event the host will forward
 - `host` -> `runtime`

 ## The schema

```text
capability   = namespace "." host/widget ":" action "." modifier [ ":" modifier_data ]

namespace     = "m"                                ; stable
              / "org.matrix.mscXXXX"               ; unstable prefix of this proposal, one for all
source        = "widget"                           ; the widget sends this action (a request)
              / "host"                             ; the host sends this action (a subscription)
action        = the action's stable name, a verb, e.g. "send_event", "read_events", "forward_event"
modifier      = a variant of the action, a descriptive word: "state", "delayed", "sticky", "room"
modifier_data = each action defines its own formatting how the modifier_data is interpreted
                as of today: eventTypes:`m.room.message#m.text` and Room Ids `#roomid:server.org` are the only existing examples
```

- `source` is the value of the `source` field of the MSC4412 envelope: `widget` for messages the
  widget starts, `host` for messages the host starts. All capabilities are held by the widget;
  `source` only says who sends the action.
- The action part is always the **stable** action name, even while the action itself is sent with
  an unstable name (`org.matrix.msc2876.read_events` → `m.widget.read_events`). The unstable prefix
  lives in `namespace` only, and there is one for the whole schema instead of one per MSC.
- A **modifier** is a separate capability that has to be held *in addition* to the plain one.
  `m.widget.send_event.delayed` alone sends nothing; together with
  `m.widget.send_event:m.room.message` it allows delayed messages.
- `#` keeps today's parsing rules: for event types it narrows `m.room.message` to one `msgtype`
  (any other type is taken whole, since `#` may appear in event types); for state events it
  narrows to one state key; a trailing `#` means the empty state key.

### Read as sentences

```text
m.widget.send_event:m.room.message                the widget may send events of type m.room.message
m.widget.send_event.delayed                       the widget may send events, delayed
m.widget.read_events.room:!abc:example.org        the widget may read events, in room !abc:example.org
m.host.forward_event.type:m.room.message          the host forwards events of type m.room.message
m.host.update_state.type:m.room.member#@a:x       the host updates the state of m.room.member for @a:x
m.host.update_theme                               the host updates the theme
```

### Host capabilities are subscriptions

A `host` capability is held for as long as the widget runs. Granting it starts the subscription and
revoking it ends it; there is no separate "start" request.

## Renamed actions

Rule 5 needs every action name to be a verb, and the host's `send_event` / `send_to_device` mean
the opposite of the widget's actions with the same name. The host therefore uses `forward_` for
what it relays and `update_` for values that changed. Old names stay accepted as aliases, like the
unstable spellings today.

| direction | current name | new name |
|---|---|---|
| host → widget | `send_event` | `forward_event` |
| host → widget | `send_to_device` | `forward_to_device` |
| host → widget | `openid_credentials` | `forward_openid_credentials` |
| host → widget | `theme_change` | `update_theme` |
| host → widget | `language_change` | `update_language` |
| host → widget | `visibility` | `update_visibility` |
| widget → host | `matrix_context` | `get_matrix_context` |
| widget → host | `client_context` | `get_client_context` |
| widget → host | `user_directory_search` | `search_user_directory` |
| widget → host | `rtc_livekit_get_token` | `get_rtc_livekit_token` |
| widget → host | `rtc_livekit_delegate_delayed_leave` | `delegate_rtc_livekit_delayed_leave` |

Unchanged because they already read as a sentence: `update_state`, `update_turn_servers`,
`notify_capabilities` and every other widget action.

## Exceptions

Only the handshake needs no capability, because it has to work before any capability exists:

| action | why it needs no capability |
|---|---|
| `content_loaded` (widget → host) | part of the startup handshake |
| `request_capabilities` (widget → host) | asks for capabilities in the first place |
| `notify_capabilities` (host → widget) | the answer to `request_capabilities` |

Replies are part of the action they answer and need nothing extra. That includes
`forward_openid_credentials`, the late answer to `get_openid`, which is covered by
`m.widget.get_openid`.

## Widget → host actions

| action | proposed capability (or capabilities) | today |
|---|---|---|
| `send_event` (timeline) | `m.widget.send_event:<type>[#<msgtype>]` | `msc2762.send.event:<type>[#<msgtype>]` |
| `send_event` (state) | `m.widget.send_event.state:<type>[#<state_key>]` | `msc2762.send.state_event:<type>[#<state_key>]` |
| `send_event` with `delay` | + `m.widget.send_event.delayed` | `msc4157.send.delayed_event` |
| `send_event` with `sticky_duration_ms` | + `m.widget.send_event.sticky` | `msc4407.send.sticky_event` |
| `send_event` with `room_id` | + `m.widget.send_event.room:<room_id>` | `msc2762.timeline:<room_id>` (shared) |
| `update_delayed_event` | `m.widget.update_delayed_event` | `msc4157.update_delayed_event` |
| `read_events` (timeline) | `m.widget.read_events:<type>[#<msgtype>]` | `msc2762.receive.event:<type>[#<msgtype>]` (shared) |
| `read_events` (state) | `m.widget.read_events.state:<type>[#<state_key>]` | `msc2762.receive.state_event:<type>[#<state_key>]` (shared) |
| `read_events` with `room_ids` | + `m.widget.read_events.room:<room_id>` | `msc2762.timeline:<room_id>` (shared) |
| `read_relations` | `m.widget.read_relations:<type>[#<msgtype>]` | none; results filtered by `receive.event` (shared) |
| `read_relations` with `room_id` | + `m.widget.read_relations.room:<room_id>` | `msc2762.timeline:<room_id>` (shared) |
| `read_room_account_data` | `m.widget.read_room_account_data:<type>` | `com.beeper.capabilities.receive.room_account_data:<type>` |
| `read_room_account_data` with `room_ids` | + `m.widget.read_room_account_data.room:<room_id>` | `msc2762.timeline:<room_id>` (shared) |
| `send_to_device` | `m.widget.send_to_device:<type>` | `msc3819.send.to_device:<type>` |
| `get_openid` | `m.widget.get_openid` | none (the user is asked per request) |
| `get_rtc_transports` | `m.widget.get_rtc_transports` | `msc4515.rtc_transports` |
| `search_user_directory` | `m.widget.search_user_directory` | `msc3973.user_directory_search` |
| `get_media_config` | `m.widget.get_media_config` | `msc4039.upload_file` (shared) |
| `upload_file` | `m.widget.upload_file` | `msc4039.upload_file` (shared) |
| `download_file` | `m.widget.download_file` | `msc4039.download_file` |
| `get_rtc_livekit_token` | `m.widget.get_rtc_livekit_token` | `msc4533.rtc_livekit_get_token` |
| `delegate_rtc_livekit_delayed_leave` | `m.widget.delegate_rtc_livekit_delayed_leave` | `msc4533.rtc_livekit_delegate_delayed_leave` |
| `navigate` | `m.widget.navigate` | `msc2931.navigate` |
| `set_always_on_screen` | `m.widget.set_always_on_screen` | `m.always_on_screen` |
| `get_matrix_context` | `m.widget.get_matrix_context` | `msc4412.matrix_context` |
| `get_client_context` | `m.widget.get_client_context` | `msc4412.client_context` |
| `watch_turn_servers` / `unwatch_turn_servers` | replaced by `m.host.update_turn_servers` (see open questions) | `msc3846.turn_servers` (shared) |

"(shared)" marks today's capabilities that govern more than one action; rule 3 splits them.

## Host → widget actions

| action | proposed capability | today |
|---|---|---|
| `forward_event` (timeline events) | `m.host.forward_event:<type>[#<msgtype>]` | `msc2762.receive.event:<type>[#<msgtype>]` (shared) |
| `forward_event` (state events as they arrive in the timeline) | `m.host.forward_event.state:<type>[#<state_key>]` | `msc2762.receive.state_event:<type>[#<state_key>]` (shared) |
| `forward_event` (sticky events) | + `m.host.forward_event.sticky` | `msc4407.receive.sticky_event` (not delivered yet) |
| `update_state` | `m.host.update_state:<type>[#<state_key>]` | `msc2762.receive.state_event:<type>[#<state_key>]` (shared) |
| `forward_to_device` | `m.host.forward_to_device:<type>` | `msc3819.receive.to_device:<type>` |
| `update_turn_servers` | `m.host.update_turn_servers` | `msc3846.turn_servers` (shared) |
| `update_theme` | `m.host.update_theme` | none |
| `update_language` | `m.host.update_language` | none |
| `update_visibility` | `m.host.update_visibility` | none |

## Examples

A video call widget that publishes its membership as a sticky event, schedules a delayed leave and
follows the other members:

```text
m.widget.send_event:m.rtc.member
m.widget.send_event.sticky
m.widget.send_event.delayed
m.widget.update_delayed_event
m.host.forward_event:m.rtc.member
m.host.forward_event.sticky
m.widget.get_rtc_transports
m.widget.get_rtc_livekit_token
m.widget.delegate_rtc_livekit_delayed_leave
```

A widget that only reads and follows text messages:

```text
m.widget.read_events:m.room.message#m.text
m.host.forward_event:m.room.message#m.text
```

## Migration

Every current capability maps to a fixed set of new ones, so a host can accept the old names and
expand them. That keeps legacy widgets (and the compat wrapper) working unchanged:

| current capability | expands to |
|---|---|
| `receive.event:<t>` | `widget.read_events:<t>`, `widget.read_relations:<t>`, `host.forward_event:<t>` |
| `receive.state_event:<t>#<k>` | `widget.read_events.state:<t>#<k>`, `host.update_state:<t>#<k>`, `host.forward_event.state:<t>#<k>` |
| `timeline:<r>` | `widget.send_event.room:<r>`, `widget.read_events.room:<r>`, `widget.read_relations.room:<r>` |
| `upload_file` | `widget.upload_file`, `widget.get_media_config` |
| `turn_servers` | `host.update_turn_servers` |
| any other | the one capability in the tables above |

Theme, language and visibility updates and `get_openid` had no capability so far. For widgets that
use the old names, a host should treat them as granted, to keep today's behaviour.

The renamed actions are accepted under their old names as aliases, in both directions, for as long
as legacy widgets exist.

## Open questions

- **`watch_turn_servers` / `unwatch_turn_servers`.** With host capabilities as subscriptions these
  actions are redundant: holding `m.host.update_turn_servers` is the subscription. If they stay,
  they need their own capabilities (`m.widget.watch_turn_servers` would then duplicate the
  subscription capability, and stopping should always be allowed). Proposal: deprecate them.
- **Room scope as a modifier.** `.room:<room_id>` is a separate capability per action. The
  alternative is to put the room into every capability (`m.widget.read_events:<room_id>/<type>`).
  The modifier keeps the common single-room case short and matches how `room_id` is an optional
  field of the request.
- **`m.host` may be read as "a capability of the host".** It is the envelope's `source` value, and
  all capabilities belong to the widget; the docs need to say so clearly.
- **Should `update_delayed_event` be narrowed** by its `action` (`#cancel`, `#restart`, `#send`)?
  Today it is not, so the proposal does not add it.
- **`send_to_device` encryption.** Today encrypted and unencrypted sends share one capability.
  A `.encrypted` modifier would be possible, but would add granularity, which is out of scope here.
- **Auto-approval.** More capabilities mean more to approve. Hosts will want groups (e.g. "a call
  widget") that grant a fixed set at once. Groups are a UI concern and do not change the names.
