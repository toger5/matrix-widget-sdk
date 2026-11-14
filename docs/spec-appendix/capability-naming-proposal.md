# Proposal: one capability per action

Status: draft for discussion. The scheme itself (the capability format, the verbs, one
capability per action) is now part of
[MSC4412](https://github.com/matrix-org/matrix-spec-proposals/pull/4412); this document keeps the
full list of actions, their capabilities and the migration from today's names. Where the two
differ, MSC4412 wins.

The tables below use the stable spelling (`m.`). Until an action is in the spec, the `m` is
replaced by the unstable prefix of the MSC that defines the action, see [The schema](#the-schema).

Today's capability names grew one MSC at a time. Each MSC picked its own prefix and shape
(`org.matrix.msc2762.receive.event:<type>`, `town.robin.msc3846.turn_servers`,
`com.beeper.capabilities.receive.room_account_data:<type>`, ...), and several capabilities silently
cover more than one action. This document proposes a naming scheme in which the capability for an
action can be derived from the action's name, in both directions.

## Rules

1. **Every capability maps clearly to one action.**
2. **One action can have multiple capabilities.** We call the different capabilities of one action
   its *modifiers*.
3. **Actions have only one direction.** A widget → host action is always distinct from a
   host → widget action.
4. **Capabilities for host actions can be interpreted as subscriptions.** Holding one means the host
   sends that action to the widget whenever there is something to send (a new event, changed state,
   a new theme). They use the same pattern as widget actions, with `host` instead of `widget`.
5. **Every capability reads as a sentence.** Action names are verbs, so that
   - `widget:m.<action>.<modifier>:<data>` reads "the widget may *&lt;action&gt;*, *&lt;modifier&gt;*,
     for *&lt;data&gt;*", and
   - `host:m.<action>.<modifier>:<data>` reads "the widget has the capability that the host
     *&lt;action&gt;s*, *&lt;modifier&gt;*, for *&lt;data&gt;*".

   This rule renames some actions, see [Renamed actions](#renamed-actions).
6. **One widget, one room.** No capability names a room. A widget acts in the room it is embedded
   in and nowhere else, see [One widget, one room](#one-widget-one-room).

## The schema

```text
capability    = source ":" action [ "." modifier ] [ ":" modifier_data ]

source        = "widget"                           ; the widget sends this action (a request)
              / "host"                             ; the host sends this action (a subscription)
action        = namespace "." name                 ; the value of the action's `action` property
namespace     = "m"                                ; the action is part of the spec
              / unstable prefix of the MSC that defines the action, e.g. "org.matrix.msc2876"
name          = the action's name, a verb, e.g. "send_event", "read_events", "forward_event"
modifier      = a variant (clearly defined enum) of the action, a descriptive word:
                "timeline", "state", "delayed", "sticky"
modifier_data = additional constraints that are arbitrary data outside the modifier enum.
                Each action (or action modifier) defines how its modifier_data is interpreted.
                As of today event types (`m.room.message#m.text`, `m.room.member#@a:x`) are the
                only existing example.
```

- `source` is the value of the `source` field of the MSC4412 envelope: `widget` for messages the
  widget starts, `host` for messages the host starts. All capabilities are held by the widget;
  `source` only says who sends the action.
- The action part is **exactly the string in the `action` property** of the action, namespace
  included. While an action is sent as `org.matrix.msc2876.read_events`, its capability is
  `widget:org.matrix.msc2876.read_events.timeline:<type>`; once it is `m.read_events`, the
  capability is `widget:m.read_events.timeline:<type>`. There is no separate namespace for
  capabilities.
- The same name under two namespaces is two independent actions with two capabilities. This is
  how an action evolves: a new iteration gets a new namespace, a widget requests the capabilities
  of the iterations it knows, and the host grants the ones it knows. No version is negotiated.
- Actions that have no MSC of their own yet use the literal placeholder `org.matrix.mscXXXX` in
  this repository (`send_event`, `get_openid`, every host action, ...). The three core actions of
  MSC4412 use `org.matrix.msc4412`.
- **An action that defines modifiers has no capability without one.** `send_event`, `read_events`
  and `forward_event` always say `timeline` or `state`; `widget:m.send_event:m.room.message` is not
  a capability. Otherwise a widget holding the bare form would silently gain power whenever a new
  modifier is added to the action.
- **An action that defines no modifiers omits the modifier.** `widget:m.navigate`,
  `host:m.update_theme`. If such an action has only one kind of target, the data follows the action
  directly: `widget:m.send_to_device:m.call.invite`, `host:m.update_state:m.room.member`.
- **Some modifiers are flags that are held in addition** to a `timeline` / `state` capability.
  `widget:m.send_event.delayed` alone sends nothing; together with
  `widget:m.send_event.timeline:m.room.message` it allows delayed messages.
- `#` in an event type keeps today's parsing rules: for timeline events it narrows `m.room.message`
  to one `msgtype` (any other type is taken whole, since `#` may appear in event types); for state
  events it narrows to one state key; a trailing `#` means the empty state key.
- Parsing: `source` ends at the first `:`. The action and modifier contain no `:`, so the
  `modifier_data` starts after the next `:` and runs to the end (it may contain `:` itself, as in
  the state key `@a:x`). Name and modifier contain no `.`, so they are the last one or two
  `.`-separated parts before the data and everything in front of them is the namespace.

### Read as sentences

```text
widget:m.send_event.timeline:m.room.message       the widget may send timeline events of type m.room.message
widget:m.send_event.delayed                       the widget may send events, delayed
widget:m.read_events.state:m.room.topic           the widget may read state events of type m.room.topic
host:m.forward_event.timeline:m.room.message      the host forwards timeline events of type m.room.message
host:m.update_state:m.room.member#@a:x            the host updates the state of m.room.member for @a:x
host:m.update_theme                               the host updates the theme
```

### Host capabilities are subscriptions

A `host` capability is held for as long as the widget runs. Granting it starts the subscription and
revoking it ends it; there is no separate "start" request.

### One widget, one room

A widget is embedded in one room and all its actions apply to that room. There is no capability
for another room and no modifier that names one, which keeps the scheme strict: nothing a widget
can request reaches beyond the room the user put it in.

Requests that carry a `room_id` / `room_ids` field are only valid for the widget's own room. Today's
`msc2762.timeline:<room_id>` capability has no equivalent and is never granted.

## Renamed actions

Rule 5 needs every action name to be a verb, and the host's `send_event` / `send_to_device` mean
the opposite of the widget's actions with the same name. The host therefore uses `forward_` for
what it relays and `update_` for values that changed. The old names are not accepted any more; the
compatibility wrapper translates them for legacy widgets.

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
| widget → host | `content_loaded` | `notify_ready` (renamed by MSC4412) |
| host → widget | `notify_capabilities` | `update_capabilities` (renamed by MSC4412) |

Unchanged because they already read as a sentence: `update_state`, `update_turn_servers`,
`request_capabilities` and every other widget action.

MSC4412 recommends these verbs. Widget → host: `send` (the host sends something Matrix related on
the widget's behalf), `request` (the widget asks for a change in the host), `notify` (the widget
informs the host about its own state). Host → widget: `update` (the current, full state of
something; it replaces what was sent before) and `forward` (something that happened elsewhere;
every action is a separate occurrence). The older actions `read_*`, `get_*`, `search_*`,
`navigate`, ... keep their names.

## Exceptions

Only the core actions of MSC4412 need no capability, because they have to work before any
capability exists:

| action | why it needs no capability |
|---|---|
| `notify_ready` (widget → host) | the widget is ready to be shown |
| `request_capabilities` (widget → host) | asks for capabilities in the first place |
| `update_capabilities` (host → widget) | tells the widget which capabilities it holds (the full list, also when the host takes some away) |

Replies are part of the action they answer and need nothing extra. That includes
`forward_openid_credentials`, the late answer to `get_openid`, which is covered by
`widget:m.get_openid`.

## Widget → host actions

| action | proposed capability (or capabilities) | today |
|---|---|---|
| `send_event` (timeline) | `widget:m.send_event.timeline:<type>[#<msgtype>]` | `msc2762.send.event:<type>[#<msgtype>]` |
| `send_event` (state) | `widget:m.send_event.state:<type>[#<state_key>]` | `msc2762.send.state_event:<type>[#<state_key>]` |
| `send_event` with `delay` | + `widget:m.send_event.delayed` | `msc4157.send.delayed_event` |
| `send_event` with `sticky_duration_ms` | + `widget:m.send_event.sticky` | `msc4407.send.sticky_event` |
| `update_delayed_event` | `widget:m.update_delayed_event` | `msc4157.update_delayed_event` |
| `read_events` (timeline) | `widget:m.read_events.timeline:<type>[#<msgtype>]` | `msc2762.receive.event:<type>[#<msgtype>]` (shared) |
| `read_events` (state) | `widget:m.read_events.state:<type>[#<state_key>]` | `msc2762.receive.state_event:<type>[#<state_key>]` (shared) |
| `read_relations` | `widget:m.read_relations:<type>[#<msgtype>]` | none; results filtered by `receive.event` (shared) |
| `read_room_account_data` | `widget:m.read_room_account_data:<type>` | `com.beeper.capabilities.receive.room_account_data:<type>` |
| `send_to_device` | `widget:m.send_to_device:<type>` | `msc3819.send.to_device:<type>` |
| `get_openid` | `widget:m.get_openid` | none (the user is asked per request) |
| `get_rtc_transports` | `widget:m.get_rtc_transports` | `msc4515.rtc_transports` |
| `search_user_directory` | `widget:m.search_user_directory` | `msc3973.user_directory_search` |
| `get_media_config` | `widget:m.get_media_config` | `msc4039.upload_file` (shared) |
| `upload_file` | `widget:m.upload_file` | `msc4039.upload_file` (shared) |
| `download_file` | `widget:m.download_file` | `msc4039.download_file` |
| `get_rtc_livekit_token` | `widget:m.get_rtc_livekit_token` | `msc4533.rtc_livekit_get_token` |
| `delegate_rtc_livekit_delayed_leave` | `widget:m.delegate_rtc_livekit_delayed_leave` | `msc4533.rtc_livekit_delegate_delayed_leave` |
| `navigate` | `widget:m.navigate` | `msc2931.navigate` |
| `set_always_on_screen` | `widget:m.set_always_on_screen` | `m.always_on_screen` |
| `get_matrix_context` | `widget:m.get_matrix_context` | none (URL template parameters) |
| `get_client_context` | `widget:m.get_client_context` | none (URL template parameters) |
| `watch_turn_servers` / `unwatch_turn_servers` | replaced by `host:m.update_turn_servers` (see open questions) | `msc3846.turn_servers` (shared) |

"(shared)" marks today's capabilities that govern more than one action; rule 1 splits them.

The type given to `read_relations` is the type of the related events that are returned. They are
timeline events, so `#` narrows `m.room.message` to one `msgtype`.

## Host → widget actions

| action | proposed capability | today |
|---|---|---|
| `forward_event` (timeline events) | `host:m.forward_event.timeline:<type>[#<msgtype>]` | `msc2762.receive.event:<type>[#<msgtype>]` (shared) |
| `forward_event` (state events as they arrive in the timeline) | `host:m.forward_event.state:<type>[#<state_key>]` | `msc2762.receive.state_event:<type>[#<state_key>]` (shared) |
| `forward_event` (sticky events) | + `host:m.forward_event.sticky` | `msc4407.receive.sticky_event` (not delivered yet) |
| `update_state` | `host:m.update_state:<type>[#<state_key>]` | `msc2762.receive.state_event:<type>[#<state_key>]` (shared) |
| `forward_to_device` | `host:m.forward_to_device:<type>` | `msc3819.receive.to_device:<type>` |
| `update_turn_servers` | `host:m.update_turn_servers` | `msc3846.turn_servers` (shared) |
| `update_theme` | `host:m.update_theme` | none |
| `update_language` | `host:m.update_language` | none |
| `update_visibility` | `host:m.update_visibility` | none |

## Examples

A video call widget that publishes its membership as a sticky event, schedules a delayed leave and
follows the other members:

```text
widget:m.send_event.timeline:m.rtc.member
widget:m.send_event.sticky
widget:m.send_event.delayed
widget:m.update_delayed_event
host:m.forward_event.timeline:m.rtc.member
host:m.forward_event.sticky
widget:m.get_rtc_transports
widget:m.get_rtc_livekit_token
widget:m.delegate_rtc_livekit_delayed_leave
```

A widget that only reads and follows text messages:

```text
widget:m.read_events.timeline:m.room.message#m.text
host:m.forward_event.timeline:m.room.message#m.text
```

## Migration

A host only understands the new names. Legacy widgets run inside the compatibility wrapper, which
translates in both directions. Every current capability maps to a fixed set of new ones, so the
wrapper requests the expansion and reports a legacy capability as approved when the host approved
its whole expansion:

| current capability | expands to |
|---|---|
| `send.event:<t>` | `widget:m.send_event.timeline:<t>` |
| `send.state_event:<t>#<k>` | `widget:m.send_event.state:<t>#<k>` |
| `receive.event:<t>` | `widget:m.read_events.timeline:<t>`, `widget:m.read_relations:<t>`, `host:m.forward_event.timeline:<t>` |
| `receive.state_event:<t>#<k>` | `widget:m.read_events.state:<t>#<k>`, `host:m.update_state:<t>#<k>`, `host:m.forward_event.state:<t>#<k>` |
| `timeline:<r>` | nothing; it is never requested and never reported as approved |
| `upload_file` | `widget:m.upload_file`, `widget:m.get_media_config` |
| `turn_servers` | `host:m.update_turn_servers` |
| any other | the one capability in the tables above |

Theme, language and visibility updates and `get_openid` had no capability so far. The wrapper
always requests `host:m.update_theme`, `host:m.update_language`, `host:m.update_visibility` and
`widget:m.get_openid` on behalf of a legacy widget, to keep today's behaviour.

The wrapper also translates the renamed actions: a legacy widget keeps sending and receiving the
old action names, including the ones without a namespace. It turns the host's
`update_capabilities { allowed }` into the legacy `notify_capabilities { requested, approved }`.

## Open questions

- **`watch_turn_servers` / `unwatch_turn_servers`.** With host capabilities as subscriptions these
  actions are redundant: holding `host:m.update_turn_servers` is the subscription. If they stay,
  they need their own capabilities (`widget:m.watch_turn_servers` would then duplicate the
  subscription capability, and stopping should always be allowed). Proposal: deprecate them.
- **`host:` may be read as "a capability of the host".** It is the envelope's `source` value, and
  all capabilities belong to the widget; the docs need to say so clearly. `runtime` instead of
  `host` was suggested as an alternative word.
- **How the parts are concatenated.** The scheme has three dimensions: source, action and
  modifier (plus its data). `source:action.modifier:data` is one way to write them down;
  an object representation (`{ source, action, modifier, data }`) would avoid the parsing rules
  altogether.
- **Should `update_delayed_event` be narrowed** by its `action` (`#cancel`, `#restart`, `#send`)?
  Today it is not, so the proposal does not add it.
- **`send_to_device` encryption.** Today encrypted and unencrypted sends share one capability.
  An `encrypted` modifier would be possible, but would add granularity, which is out of scope here.
- **Auto-approval.** More capabilities mean more to approve. Hosts will want groups (e.g. "a call
  widget") that grant a fixed set at once. Groups are a UI concern and do not change the names.
