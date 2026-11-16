---
name: widget-mscs
description: MSC4411 (the m.widget state event) and MSC4412 (the widget postMessage API - envelope, action naming, errors, capabilities, core actions), which this repository implements. Where their live text is, how they are structured, which crate or package implements which part, the related widget MSCs behind the action prefixes, and how spec changes and new MSC drafts are written in spec/patch/. Use when a task touches widget API semantics or the widget state event, asks what MSC4411 or MSC4412 say, or needs to change widget spec text or propose a new widget MSC.
---

# The widget MSCs: MSC4411, MSC4412 and `spec/patch`

The widget API is not in the Matrix spec; it exists only as MSCs. This repository is the reference
implementation of two of them. For finding and reading MSCs in general, see the `matrix-spec`
skill.

## Rules

- **Source of truth for names:** MSC4412 (envelope, core actions, error codes, capability format)
  and "The schema" in `docs/spec-appendix/capability-naming-proposal.md`. MSC4412 wins where they
  differ. Any change to an action, capability, field, platform callback or backend method follows
  `.claude/skills/widget-api-change/SKILL.md`.
- **Do not copy MSC text into the repository.** Link the PR and name the section; the text moves.
- **The code may not silently disagree with the MSCs.** A change to something MSC4411 or MSC4412
  defines, or a new action meant for a new MSC, comes with a file in `spec/patch/` in the same
  change (see below).
- MSC4412 links into this repository by URL (`github.com/toger5/matrix-widget-sdk/.../main/...`):
  `docs/spec-appendix/capability-naming-proposal.md` and `packages/widget-compat-wrapper`. Never
  move or rename them (`grep -n 'matrix-widget-sdk' "$(spec/msc.sh 4412)"` lists the links).

## Read the current text

| MSC | PR | branch (in `matrix-org/matrix-spec-proposals`) | file |
|---|---|---|---|
| MSC4411: Widget State Event | [#4411](https://github.com/matrix-org/matrix-spec-proposals/pull/4411) (draft, by toger5) | `toger5/widget-state-event` | `proposals/4411-widget-state-event.md` |
| MSC4412: Widget Base postMessage API | [#4412](https://github.com/matrix-org/matrix-spec-proposals/pull/4412) (by dbkr) | `dbkr/widget-base-postmessage-api` | `proposals/4412-widget-base-postmessage-api.md` (+ an image in `proposals/images/`) |

```sh
spec/msc.sh 4412 --info               # state, head commit, last update
grep -n '^#' "$(spec/msc.sh 4412)"    # headings; then Read the path printed by spec/msc.sh 4412
gh api repos/matrix-org/matrix-spec-proposals/pulls/4412/comments --paginate \
  --jq '.[] | "\(.path):\(.line // .original_line) \(.user.login): \(.body)"'   # review threads
```

## Structure (orientation only; headings as of 2026-11-14, read the text itself)

**MSC4411** defines what a widget is: a room state event that places it in the room.
Proposal → State Event (`m.widget`: `name`, `url`, `avatar_url`; the state key is the widget id;
Power Levels) → Accessing and rendering widgets → Default webview capabilities (the iframe
`sandbox` / `allow` defaults) → Remove `$matrix_widget_id` → Intentionally skipped topics →
Alternatives (including "Add iframe capabilities to this (state event) MSC") → Security
considerations → Potential issues (comparison with `im.vector.modular.widgets`, URL template
parameters, the widget API message wrapper, Migration) → Unstable prefix
(`org.matrix.msc4411.widget`) → Dependencies (MSC2765).

**MSC4412** defines the base of the postMessage API; every further action comes from another MSC.
Proposal → Action format (envelope: `source`, `action`, `request_id`, `request` / `response`) →
Action naming → Errors → Action timeouts → Transport → Capabilities (Capability format, Evolving
actions) → Core actions (`m.notify_ready`, `m.request_capabilities`, `m.update_capabilities`) →
State event (`uses_widget_api`) → Backwards compatibility → Potential issues → Alternatives (a
version property, other transports, comparison with the current widget API) → Security
considerations → Unstable prefix (`org.matrix.msc4412.*` for the core actions and error codes; the
envelope fields and `uses_widget_api` are not prefixed) → Dependencies (MSC4411).

## Where this repository implements what

| MSC part | here |
|---|---|
| MSC4411 `m.widget` content and event types (`m.widget`, `org.matrix.msc4411.widget`, legacy `im.vector.modular.widgets`): which events are widgets (removed ones have no string `name` / `url`), what a client loads (legacy: through the compat wrapper) | `crates/widget-host-driver/src/widget_event.rs` (`WidgetDefinition::parse` / `embed`; exported as `parse_widget_state_event`, `embed_widget`); the browser host calls it through `packages/widget-host/src/lib/widgetEvents.ts` |
| MSC4411 "Clients MUST validate the url" | `crates/widget-host-driver/src/widget_url.rs` (`widget_url_problem`: absolute http(s), WHATWG, not relative to the embedding page; `embed_url_problem`: also no page of the client's compat wrapper; table `tests/widget_urls.json`) |
| MSC4411 iframe `sandbox` / `allow` | `packages/widget-host/src/app/AppRoot.tsx` |
| MSC4411 URL templates (removed; legacy widgets only) | `packages/widget-compat-wrapper/src/template.ts` |
| MSC4412 envelope, namespaces (`MSC4412_NAMESPACE`, `PLACEHOLDER_NAMESPACE`, `STABLE_NAMESPACE`), errors (`WidgetError`), timeouts | `crates/widget-actions/src/wire.rs` |
| MSC4412 action naming: wire names, stable `m.` aliases | serde `rename` / `alias` in `crates/widget-actions/src/actions/{widget,host}/mod.rs` |
| MSC4412 capability format | `crates/widget-actions/src/capabilities.rs`; all actions and their capabilities in `docs/spec-appendix/capability-naming-proposal.md` |
| MSC4412 core actions | `crates/widget-actions/src/actions/widget/{notify_ready,request_capabilities}.rs`, `crates/widget-actions/src/actions/host/update_capabilities.rs`; handshake and approval in `crates/widget-host-driver/src/driver/` and `platform.rs` |
| MSC4412 limited grants (proposed: `spec/patch/msc4412/capability-lifetimes.md`) | single use in the driver: `WidgetHostDriver::set_single_use` (`driver/mod.rs`), used up in `driver/requests.rs` `handle_request`; time limits are the platform's timer plus `revoke_capabilities` |
| MSC4412 transport | widget: `crates/widget-base-sdk/src/wasm.rs`; host: `packages/widget-host/src/app/runtime/widgetRuntime.ts` |
| MSC4412 `uses_widget_api` | `widget_event.rs` (`WidgetDefinition.uses_widget_api`, `WidgetEmbed.uses_widget_api`); the host's runtime: `packages/widget-host/src/app/runtime/widgetRuntime.ts` |
| MSC4412 backwards compatibility | the driver rejects legacy messages (`DriverError::LegacyWidgetApi`, `crates/widget-host-driver/src/error.rs`); `packages/widget-compat-wrapper` runs legacy widgets |
| Comparison with matrix-widget-api, decisions, raised conflicts | `docs/parity.md` §1, §2, §4 |

## Related widget MSCs

Every action carries the unstable prefix of the MSC that defines it, or the placeholder
`org.matrix.mscXXXX` when it has none. The wire names in use (other `org.matrix.msc…` strings in
the crate are legacy names in tests and comments):

```sh
grep -hoE 'rename = "[a-z]+\.[^"]+"' crates/widget-actions/src/actions/{widget,host}/mod.rs | sort -u
```

| MSC | title | used here for |
|---|---|---|
| 2876 | Allowing widgets to read events in a room (closed, rolled into MSC2762) | `read_events` |
| 3869 | Read event relations with the Widget API | `read_relations` |
| 4157 | Delayed Events (widget api); client-server side: MSC4140 | `update_delayed_event`, `send_event` with `delay` |
| 4515 | RTC Transports discovery for widgets | `get_rtc_transports` |
| 3973 | Search users in the user directory with the Widget API | `search_user_directory` |
| 4039 | Access the Content repository with the Widget API | `get_media_config`, `upload_file`, `download_file` |
| 4533 | MatrixRTC widget actions for authenticated livekit related endpoints | `get_rtc_livekit_token`, `delegate_rtc_livekit_delayed_leave` |
| 2931 | Allow widgets to navigate with matrix.to URIs | `navigate` |

Behind actions that use the placeholder (`docs/parity.md` §2 has the full table): MSC2762
(sending/receiving events: `send_event`, `forward_event`, `update_state`), MSC3819 (to-device),
MSC1960 (OpenID, merged; as a capability: the draft `spec/patch/new/openid-capability.md`), MSC3846 (TURN servers), MSC2873 (client and theme), MSC4407 / MSC4354
(sticky events), MSC2974 and MSC2871 (capability re-exchange and approval). `com.beeper.read_room_account_data`
has no MSC (related: MSC3751). Also watch MSC4541 ("Widget state"), an alternative proposal for
the widget state event. All widget MSCs:
`gh pr list -R matrix-org/matrix-spec-proposals --label A-Widgets --state all --limit 100`.

## Changing the spec: `spec/patch/`

Read [`spec/patch/README.md`](../../../spec/patch/README.md) first; it has the file templates and the
lifecycle. In short:

1. `spec/msc.sh <N> --info` (its `read at` commit is the patch's Base), then copy
   `"$(spec/msc.sh <N>)"` to a temporary file and edit the copy.
2. Write `spec/patch/msc<N>/<slug>.md`: header, Why, Change in prose, and the output of
   `spec/msc.sh <N> --diff <copy>` in a four-backtick `diff` block.
3. `spec/msc.sh <N> --check spec/patch/msc<N>/<slug>.md` must print `applies to MSC<N> at <commit>`.
4. A new MSC is `spec/patch/new/<slug>.md` in the upstream template, numbered `MSCXXXX`, with the
   unstable prefix `org.matrix.mscXXXX` that the code already uses for actions without an MSC.
5. The code change that goes with it follows `.claude/skills/widget-api-change/SKILL.md`.
