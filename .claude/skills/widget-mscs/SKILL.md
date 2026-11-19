---
name: widget-mscs
description: MSC4411 (the m.widget state event) and MSC4412 (the widget postMessage API - envelope, action naming, errors, capabilities, core actions), which this repository implements. Where their live text is, how they are structured, which crate or package implements which part, the related widget MSCs behind the action prefixes, and how spec changes and new MSC drafts are written in spec/patch/. Use when a task touches widget API semantics or the widget state event, asks what MSC4411 or MSC4412 say, or needs to change widget spec text or propose a new widget MSC.
---

# The widget MSCs: MSC4411, MSC4412 and `spec/patch`

The widget API exists only as MSCs; this repository is the reference implementation of two. Reading
MSCs in general: the `matrix-spec` skill. Naming rules and the change checklist: the
`widget-api-change` skill.

## Rules

- **Do not copy MSC text into the repository.** Link the PR and name the section.
- **The code may not silently disagree with the MSCs.** A change to what MSC4411/MSC4412 define, or a
  new action meant for a new MSC, comes with a file in `spec/patch/` in the same change.
- MSC4412 links into this repository by URL: `docs/spec-appendix/capability-naming-proposal.md` and
  `packages/widget-compat-wrapper`. Never move or rename them
  (`grep -n 'matrix-widget-sdk' "$(spec/msc.sh 4412)"` lists the links).

## Read the current text

| MSC | PR | branch (`matrix-org/matrix-spec-proposals`) | file |
|---|---|---|---|
| MSC4411: Widget State Event | [#4411](https://github.com/matrix-org/matrix-spec-proposals/pull/4411) (draft, toger5) | `toger5/widget-state-event` | `proposals/4411-widget-state-event.md` |
| MSC4412: Widget Base postMessage API | [#4412](https://github.com/matrix-org/matrix-spec-proposals/pull/4412) (dbkr) | `dbkr/widget-base-postmessage-api` | `proposals/4412-widget-base-postmessage-api.md` |

```sh
spec/msc.sh 4412 --info               # state, head commit
grep -n '^#' "$(spec/msc.sh 4412)"    # headings; then read the printed path
```

MSC4411 defines the `m.widget` state event (`name`, `url`, `avatar_url`; state key = widget id),
rendering and the default webview `sandbox` / `allow`; unstable type `org.matrix.msc4411.widget`.
MSC4412 defines the envelope, action naming, errors, timeouts, transport, the capability format, the
three core actions, `uses_widget_api` on the state event and backwards compatibility; every other
action comes from another MSC. Unstable prefix `org.matrix.msc4412` for core actions and error codes.

## Where this repository implements what

| MSC part | here |
|---|---|
| MSC4411 event types, which events are widgets, what a client loads | `crates/matrix-widget-host-driver/src/widget_event.rs` (`parse_widget_state_event`); host: `packages/widget-host/src/lib/widgetEvents.ts` |
| MSC4411 URL validation | `crates/matrix-widget-host-driver/src/widget_url.rs` (table `tests/widget_urls.json`) |
| MSC4411 iframe `sandbox` / `allow`, webview capabilities (drafts in `spec/patch/`) | `crates/matrix-widget-host-driver/src/webview.rs`, applied via `WidgetHostPlatform::load_iframe`; legacy inner iframe: `packages/widget-compat-wrapper/src/wrapper.ts` |
| MSC4411 URL templates (legacy only) | `packages/widget-compat-wrapper/src/template.ts` |
| MSC4412 envelope, namespaces, errors | `crates/matrix-widget-actions/src/wire.rs` |
| MSC4412 action names (`rename` / stable `alias`) | `crates/matrix-widget-actions/src/actions/{widget,host}/mod.rs` |
| MSC4412 capability format | `crates/matrix-widget-actions/src/capabilities.rs`; all capabilities in the naming proposal |
| MSC4412 core actions, handshake, approval, limited grants | `crates/matrix-widget-actions/src/actions/`, `crates/matrix-widget-host-driver/src/driver/`, `platform.rs` |
| MSC4412 transport | widget: `crates/matrix-widget-sdk/src/wasm.rs`; host: `packages/widget-host/src/app/runtime/widgetRuntime.ts` |
| MSC4412 `uses_widget_api` | `widget_event.rs`; without it the driver refuses every message (`DriverError::NoWidgetApi`) |
| MSC4412 backwards compatibility | `DriverError::LegacyWidgetApi`; `packages/widget-compat-wrapper` |
| comparison with matrix-widget-api | `docs/parity.md` |

## Related widget MSCs

Every action carries the unstable prefix of its MSC, or `org.matrix.mscXXXX` without one. Wire names
in use:

```sh
grep -hoE 'rename = "[a-z]+\.[^"]+"' crates/matrix-widget-actions/src/actions/{widget,host}/mod.rs | sort -u
```

| MSC | used here for |
|---|---|
| 3869 | `read_relations` |
| 4157 (client-server: MSC4140) | `update_delayed_event`, `send_event` with `delay` |
| 4515 | `get_rtc_transports` |
| 3973 | `search_user_directory` |
| 4039 | `get_media_config`, `upload_file`, `download_file` |
| 4533 | `get_rtc_livekit_token`, `delegate_rtc_livekit_delayed_leave` |
| 2931 | `navigate` |
| 2876 (closed) | legacy `read_events`, only via the compat wrapper; replaced by the timeline-reading draft |

Behind placeholder actions (`docs/parity.md` §2): MSC2762 (`send_event`, `forward_event`,
`update_state`), MSC3819 (to-device), MSC1960 (OpenID; as a capability: `spec/patch/new/openid-capability.md`),
MSC3846 (TURN), MSC2873 (client and theme), MSC4407 / MSC4354 (sticky events), MSC2974 / MSC2871
(capability re-exchange). `com.beeper.read_room_account_data` has no MSC (related: MSC3751). Watch
MSC4541 ("Widget state"), an alternative to MSC4411. All widget MSCs:
`gh pr list -R matrix-org/matrix-spec-proposals --label A-Widgets --state all --limit 100`.

## Changing the spec

Follow [`spec/patch/README.md`](../../../spec/patch/README.md): templates, lifecycle and the
`spec/msc.sh <N> --info / --diff / --check` commands. `--check` must print `applies to MSC<N> at
<commit>`. The code change that goes with it follows the `widget-api-change` skill.
