# Widget colour scheme: how the host's theme reaches a widget

A widget that knows nothing of the widget API (a plain web page, a Wikipedia article) still turns
dark when the widget host (`packages/widget-host`) switches to its dark theme. This document
explains why, what the host does about it, and what was measured. Measured on 2026-11-16 with
Playwright 1.65.1: Chromium 159.0.8154.6, Firefox 159.0, WebKit 27.2 (Playwright's build, not
Safari).

The theme reaches a widget in three ways:

| way | what the widget gets | when | who |
|---|---|---|---|
| CSS: the iframe's `color-scheme` | `prefers-color-scheme` inside the widget, system colours and form controls of a page that opted in | always, live | every widget, also one that does not use the widget API |
| `get_client_context` | `{ client_theme: "light" \| "dark", … }` | when the widget asks (usually while loading) | widgets with `widget:…get_client_context` |
| `update_theme` | `{ name: "light" \| "dark", is_dark }` | whenever the resolved theme changes: the setting, or the OS while the setting is "System" | widgets with `host:…update_theme` (the driver checks) |

Legacy widgets (through the compat wrapper) get the theme as the URL template variable
`$org.matrix.msc2873.client_theme`, filled in once at load from `get_client_context`, and later
changes as `theme_change`. The wrapper requests `update_theme` only after the legacy widget
answered the legacy `capabilities` request, so a plain page behind the wrapper gets no
`theme_change`, only the CSS.

## 1. The CSS path

- The tokens of the stylesheet (`packages/widget-host/design/css/tokens.css`, design rules the app
  imports through `src/styles/app.css`) give the theme a colour scheme:
  `[data-theme="dark"] { color-scheme: dark }`, `[data-theme="light"] { color-scheme: light }`.
  `AppShell` puts `data-theme` (the setting, with "System" resolved to the OS preference) on
  `.app-root` in the shadow root.
- A widget iframe is a light-DOM child of the host element, shown through a `<slot>` inside
  `.app-root` (`src/views/ui/WidgetSlot.tsx`). A slotted element inherits along the flat tree, so
  the iframe's computed `color-scheme` is the theme's. The host also sets it on the iframe itself
  (`[data-theme="dark"] ::slotted(iframe) { color-scheme: dark }`, and light), because WebKit
  passes on only a scheme set on the iframe, not an inherited one (see "Browsers").
- [CSS Color Adjustment 1](https://drafts.csswg.org/css-color-adjust-1/), §2.1: in an embedded
  document, the embedding element's colour scheme is the document's *preferred* colour scheme,
  instead of the user's preference. So `prefers-color-scheme` inside the widget is the host's
  theme, and `matchMedia(…)` fires `change` when the theme changes. §6 (privacy) accepts that this
  passes information to a cross-origin document.
- [Element Web](https://github.com/element-hq/element-web) does the same: its themes set
  `body { color-scheme: light | dark }` (`apps/web/res/themes/*/css/_*.pcss`), and its widget
  iframes inherit it (an inherited scheme, which WebKit 27.2 ignores).

What changes inside the widget depends on the page (host dark, OS light, Chromium and Firefox):

| page | what changes |
|---|---|
| no `color-scheme`, no `@media (prefers-color-scheme)` | nothing visible: only `matchMedia` flips. The page's colour scheme is the default (light): white canvas, light form controls |
| `@media (prefers-color-scheme: dark)` rules | its own dark colours. Example: a Wikipedia article with "Color: Automatic" (`?vectornightmode=2`, or a saved preference) turns dark; with Wikipedia's default "Light" it does not |
| `<meta name="color-scheme" content="light dark">` (or `:root { color-scheme: light dark }`) | system colours (`Canvas`, `CanvasText`), form controls and scrollbars go dark |

A page that refuses to be framed (`X-Frame-Options: DENY`, e.g. `Special:BlankPage` on Wikipedia)
shows the browser's error page instead. In Chromium that page follows `prefers-color-scheme` too, so
it flips with the theme.

### Browsers

The widget's `prefers-color-scheme`, new and legacy widgets alike:

| engine | OS | theme Light | theme Dark | theme System |
|---|---|---|---|---|
| Chromium 159 | light | light | dark | light |
| Chromium 159 | dark | light | dark | dark |
| Firefox 159 | light | light | dark | light |
| Firefox 159 | dark | light | dark | dark |
| WebKit 27.2 (Playwright) | light | light | dark | light |
| WebKit 27.2 (Playwright) | dark (emulated) | light | dark | dark |

All three follow theme changes live, also for a widget created in the other theme. WebKit uses
the iframe's scheme only when it is set on the iframe itself (a rule or inline style); an
inherited one is ignored and the widget sees the OS. That is why the host sets it on the slotted
iframe; with the inherited scheme alone every WebKit row is "the OS". WebKit landed the rule in April 2026
([bug 284973](https://bugs.webkit.org/show_bug.cgi?id=284973), Safari Technology Preview 242) and
live updates in July 2026 ([bug 316738](https://bugs.webkit.org/show_bug.cgi?id=316738)); whether
an inherited scheme counts is open in [csswg-drafts#13796](https://github.com/w3c/csswg-drafts/issues/13796).
Safari itself was not measured. Legacy widgets get the same in all three: the wrapper's inner
iframe has `color-scheme: normal`, which passes the wrapper's preference on.

## 2. The backdrop

When the iframe's colour scheme and the scheme of the widget's root element match, the widget's
canvas is transparent (§2.4); when they differ the browser paints an opaque canvas of the widget's
scheme. The host used to give the iframe `background: #fff`. A page with `color-scheme: light
dark` in the dark theme was therefore drawn with light text (`CanvasText`) on white. Now it is
`background: Canvas`: the iframe's own `Canvas` colour, which is what the widget would get as a
top-level page (rgb(18, 18, 18) in Chromium, rgb(28, 27, 34) in Firefox). Pages that do not opt in
are unaffected: they show white either way (their own opaque canvas in the dark theme, the light
`Canvas` backdrop in the light theme). `e2e/widgetTheme.spec.ts` checks it.

## 3. Hidden widgets

- **Loading** (until `notify_ready`): the iframe has the `hidden` attribute. It used to be
  `display: none`, which has no computed style. The widget then saw the OS preference in Chromium
  and Firefox and flipped to the theme when it was shown, although MSC4412 expects a widget to
  set itself up before `notify_ready`. Now it is `visibility: hidden`: the iframe is laid out
  under the loading layer, so the widget already has the theme's scheme and its final size. It is
  still not painted and not reached by a click or Tab (the e2e test presses Tab 25 times; an
  iframe that can take focus is reached after 14). In Chromium a widget can still focus itself by
  script (`input.focus()`) and then gets the keys typed into the host, as a shown widget can;
  Firefox and WebKit refuse. Only `display: none` prevents that in Chromium (`inert`,
  `content-visibility: hidden` and `opacity: 0` do not).
- **In a tab that is not shown** (no `<slot>` rendered): the iframe is not in the flat tree and
  has no style. The widget sees "light" in Chromium and the OS preference in Firefox, and gets
  a `change` event when its tab is shown. A view cannot style an unslotted element, so this stays.
  Widgets that hold `update_theme` are told the theme anyway, and `get_client_context` answers
  it.

## 4. Testing it with Playwright

Playwright's colour scheme emulation (`colorScheme` of a context, `"light"` by default, or
`page.emulateMedia`) overrides the scheme an iframe passes on in Chromium: the widget then sees
the emulated value whatever the theme. Firefox's emulation does not override it, nor does
WebKit's for a scheme set on the iframe (WebKit's `"dark"` overrides an inherited one). A test
of this path calls `page.emulateMedia({ colorScheme: null })` first and restores it afterwards
(`e2e/widgetTheme.spec.ts`). To emulate an OS change for the host itself, `emulateMedia` with
`"dark"` / `"light"` still works.

## 5. Options that were considered

Measured with the host's CSS for `::slotted(iframe)` changed (Chromium and Firefox; in WebKit
27.2 every row but "now" gives the OS):

| `::slotted(iframe)` | widget's `prefers-color-scheme` | `light dark` page readable in the dark theme |
|---|---|---|
| inherited scheme, `background: #fff` (before) | the theme | no: light text on white |
| the theme's scheme set on the iframe, `background: Canvas` (**now**) | the theme | yes |
| `color-scheme: normal` | the OS | yes |
| `color-scheme: light dark` | the OS | no, when the OS is dark |
| `color-scheme: light dark; background: Canvas` | the OS | yes |

- **(a) The widget follows the theme, like a part of the client (chosen).** It is what the spec
  intends and what Element Web does, so a widget looks the same in this host as in Element Web.
  The theme also goes over the widget API (`update_theme` on every change, `get_client_context`),
  so a widget can use either.
- **(b) The widget follows the OS** (`color-scheme: normal`, or `light dark` with a `Canvas`
  backdrop), and the theme only reaches it over the widget API. This would show whether a widget
  takes its theme from the API, but widgets that follow `prefers-color-scheme` would not match the
  host when the theme and the OS differ, and Element Web behaves the other way.
- **(c) A setting or dev tools switch** between (a) and (b). It is not built; it would be a dev
  tools feature for testing widgets.

## 6. Recommendation for the spec (not proposed yet)

- MSC4411, "Default webview capabilities": web clients SHOULD set `color-scheme` on the widget
  iframe element itself (WebKit ignores an inherited one) to the client's current scheme (`light`
  or `dark`), so `prefers-color-scheme` inside the widget and the default colours of a widget
  that opted in match the client. Clients SHOULD NOT give the iframe an opaque background of a
  fixed colour (a widget in the same scheme has a transparent canvas). Native clients have the
  same choice for their webview's appearance.
- MSC4412, `m.notify_ready`: a widget that decides its theme before `notify_ready` should use
  `get_client_context`, not `prefers-color-scheme`. A hidden iframe may report a different scheme
  than the visible one, depending on how the client hides it, and Safari's support is recent.

## Sources

- [CSS Color Adjustment Module Level 1](https://drafts.csswg.org/css-color-adjust-1/): §2.1
  (embedded documents), §2.4 (opaque canvas on a mismatch), §6 (privacy);
  [Media Queries 5, `prefers-color-scheme`](https://drafts.csswg.org/mediaqueries-5/#prefers-color-scheme)
- CSSWG issues [#7493](https://github.com/w3c/csswg-drafts/issues/7493) (`prefers-color-scheme` in
  iframes), [#13796](https://github.com/w3c/csswg-drafts/issues/13796) (an iframe without its own
  `color-scheme`; nested iframes)
- [Chrome: dark mode guidance](https://developer.chrome.com/docs/modern-web-guidance/guides/visual-design/dark-mode)
  (Chrome and Firefox respect `color-scheme` for iframes, Safari did not)
- WebKit bugs [284973](https://bugs.webkit.org/show_bug.cgi?id=284973) (fixed in 310465@main),
  [316738](https://bugs.webkit.org/show_bug.cgi?id=316738) (live updates, fixed in 316467@main),
  [228124](https://bugs.webkit.org/show_bug.cgi?id=228124) (opaque canvas on a mismatch)
- [MSC2873](https://github.com/matrix-org/matrix-spec-proposals/pull/2873) (client theme),
  [MSC4411](https://github.com/matrix-org/matrix-spec-proposals/pull/4411),
  [MSC4412](https://github.com/matrix-org/matrix-spec-proposals/pull/4412)
