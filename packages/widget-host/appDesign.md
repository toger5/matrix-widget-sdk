# Widget host app design

This document describes the concepts and views of the host app.

# Design

Take inspiration from IDE designs, but make things a bit more rounded.

![reference_image](https://cdn.dribbble.com/userupload/47290357/file/0f4b08fa1dd0007d68725d26938fc2d4.jpg?resize=1504x1128&vertical=center)

Support a light and a dark theme. Work with a configurable color palette (highlight, dark, primary, ... the usual app palette roles).

What to take from the `reference_image`:

- The leftmost bar: its style and its small size (see [LeftBar](#leftbar)).
- The panel named "Core product": this is the position and style of the [SidePanel](#sidepanel).
- The rounded boxes are the inspiration for room panels, tabs and the PiP boxes.
- The header bar is removed.
- The "Overview" label becomes the room name.
- The tiles are replaced by the widget. The widget gets no padding and spans the full area of its box.
- The tab style of the room box: the tabs sit in the header row of the box, next to the room name. Every tab has a slightly different background than the header. Only the active tab has a border. There is no accent color.

While the [DevBackend](#devbackend) is active, the app background (on which all panels are shown) becomes a "construction fence": 45° stripes alternating between a slightly lighter and a slightly darker shade. This indicates that the widgets only get the values of the DevBackend.

# Features

- Multi-account ([AccountView](#accountview))
- An in-memory session that mocks a full session: multiple rooms and all events in them ([DevBackend](#devbackend))
- Copy an existing room into the DevBackend (last X timeline events + state) to experiment with it entirely offline
- Custom widgets: add a widget to a room, only in this host or as a state event of the room ([RoomOverview](#roomoverview))
- Dev tools for the open rooms: explore their state and timeline, send custom events and state ([Dev tools](#dev-tools))
- Tabbed widget panels ([RoomView](#roomview))
- Multiple room panels ([RoomsArea](#roomsarea))
- User device management, via a button that links to the OIDC auth service (MAS)
- Always-on-screen support ([PictureInPicturePanel](#pictureinpicturepanel))

# Structure

## LeftBar

See the leftmost bar in the `reference_image`. It contains:

- An app icon in the top left corner. It opens a modal explaining what this app is.
- A + button, equivalent to Ctrl+N (new room panel).
- A room list button. It opens the [Room list](#room-list).
- A Dev tools button (while dev tools are enabled or the [DevBackend](#devbackend) is active, then highlighted). It opens and closes the [Dev tools](#dev-tools); it never switches accounts.
- A settings button. It opens [Settings](#settings).
- The user avatar. It opens the [AccountView](#accountview). While the DevBackend is active, it is the DevBackend icon.
- A collapse button.

Collapsing the bar shows a toast: "Press Esc to show the expand button". Pressing Escape only reveals the expand icon; pressing that icon shows the bar again.

## SidePanel

One panel next to the LeftBar, positioned and styled like the "Core product" panel in the `reference_image`. It hosts one of AccountView, Settings, the Room list or the [Dev tools](#dev-tools). When it opens, the RoomsArea is shifted to the side.

### AccountView

- The current account at the top: avatar and the default account information, including whether this device is verified. That state follows the session, whatever changes it.
- Buttons: Manage account & devices (opens the MAS account page), Copy Matrix URI, Log out.
- At the bottom, a list to switch to the other logged-in accounts and, while it is enabled, the DevBackend: "switch to: `<Avatar>` `<AccName>`", with "switch to" very small above the name and an arrow icon on the right. Its last entry is "Add account" (opens the OIDC login page).

While this device is not verified (other devices share the keys of encrypted rooms only with verified devices), a "Verify this device" box under the account card offers two ways:

- With another device: the request goes to the account's other devices. Once one accepts, both show the same 7 emoji: "They match" / "They don't match". After "They match", wait for the other device.
- With the recovery key: one field and "Verify". A refused key stays in the form, with the reason.
- While a step runs, the box replaces the device details and the buttons, and every step can be cancelled. Closing the AccountView does not stop it (a toast reports how it ended); activating the DevBackend does.
- A verification that fails (cancelled, timed out, the emoji differ) shows the box again, with the reason. One that succeeds says so until "Done".

In DevBackend mode the account icon is the DevBackend icon, and the view shows the full list of accounts with buttons: "switch to `<AccName>`". "Add account" is again the last entry of the list.

### Settings

- Two independent switches. What one enables is hidden while it is off and listed under it while it is on:
  - Dev tools: the [Dev tools](#dev-tools) button in the LeftBar, the overflow button of widget tabs with the [WidgetDevToolBar](#widgetdevtoolbar), and "Add widget" in the [RoomOverview](#roomoverview).
  - DevBackend: the DevBackend in the account list and at the bottom of the Dev tools, and "Copy to DevBackend" in the RoomOverview. It cannot be turned off while the DevBackend is active.

### Room list

The [room picker](#room-picker), titled "Rooms". A pick opens in the room panel that shows the room, else in the focused empty room panel, else in a new room panel next to the focused one. In a narrow window the SidePanel closes after a pick.

## RoomsArea

The RoomsArea is the main area of the logged-in view. It allows opening multiple room panels next to each other.

- By default there is one panel per room.
- Ctrl+N opens a new panel on the right with the [room picker](#room-picker) (a pick turns it into that room), Ctrl+Shift+N one showing the same room.
- Ctrl+W closes the shown tab of the focused panel, and a panel whose only tab is the room name.

### Room picker

No title. From top to bottom, a group without entries is left out:

- Recent widgets: tiles of the last 4 opened widgets (name and room). Pressing one opens the widget as a tab of its room. A widget that is open in a tab is marked "open"; pressing it jumps to that tab.
- Recent rooms: tiles of the last 4 rooms opened in a room panel (number of widgets and members). Pressing one opens the room on its RoomOverview.
- All rooms: a search field and the list of all rooms. When the field gets the focus or a query, it scrolls to the top, so the matches show right under it; the tiles stay. Enter opens the first match, Escape clears the search.

## RoomView

A room view is a tabbed container, shown inside a room panel. Its first tab is the room name, which shows the [RoomOverview](#roomoverview); the other tabs hold open widgets and the [RoomTimeline](#roomtimeline) (see [Tabs](#tabs)).

- A room opens on its RoomOverview and returns to it when its last tab is closed. Closing another tab shows its neighbour.
- A widget or the timeline opened from the RoomOverview becomes a new tab at the end.
- The + button of the tab bar selects the room name.
- A widget runs only once per account, also when two room views show the same room.

## Tabs

- **Room name**: avatar, room name and the number of widgets and users (visible text with tooltips). It cannot be closed. Unselected it is plain header text; selected it looks like an active tab.
- **WidgetTab**: contains the full widget. The tab name is the widget name, with the widget icon/avatar if available. It has a close button and, with dev tools enabled, an overflow button (three dots) that opens the [WidgetDevToolBar](#widgetdevtoolbar). An always-on-screen widget gets a pin icon (see [PictureInPicturePanel](#pictureinpicturepanel)).
- **Timeline**: the [RoomTimeline](#roomtimeline), at most one per room view. A message icon, "Timeline" and a close button; no overflow button, no pin.

## RoomOverview

- Avatar, name, ID and description, and "Open timeline" ("Show timeline" when this room view has it).
- Widget list, first and full width. Pressing a widget opens it. A widget that is already open is grayed out, says where it is open and offers:
  - "jump to tab"
  - "move widget here", if it is open in another room view: it closes the tab there and opens the widget in this room view.
- "Add widget" (dev tools) opens a form at the top of the widget list: the widget or Element Call form of the Dev tools, or a pasted state event. It adds the widget, it does not open it:
  - only in this host (the default): a local widget, kept in this browser for this account and room and never sent. The same type and ID replaces it.
  - to the room: sends the state event as you. Replacing a widget of the room asks first; a refusal (no permission) is shown in the form, the draft stays.
- Local widgets follow the room's widgets, marked "Local", with edit (dev tools; the widget form without the target, type and ID fixed, "Save") and remove (asks first). They are listed and run also with dev tools disabled.
- Encryption status and member list
- DevBackend card (DevBackend enabled, not in a DevBackend room): "Copy to DevBackend". It does not copy local widgets.

## RoomTimeline

The events of the room, for debugging. No composer.

- Oldest at the top, newest at the bottom. New events (also the ones widgets send) appear live; while scrolled to the bottom, it stays there.
- One line per event, under a heading per day: time, sender (user ID), what happened in words, event type. State events are muted. Nothing is hidden: undecryptable and deleted events, reactions and edits get a line too.
- Pressing a line shows the event's JSON.
- At the top: "Load older events", or "Start of the room" once it is reached. It first shows loaded events that are not rendered yet, then asks the session for more; it is disabled while loading.

## Capability prompt

A widget's request for capabilities covers its WidgetTab with a permission card until it is answered (in a PiP box: one line and "Open to answer").

- Header: the widget icon, "<widget> asks for permissions" and one sentence of what it wants in plain words, the risky parts first and in bold.
- The capabilities in sections, in this order: Read this room, Send as you, Change the room, Direct messages to devices, You and your account, Files, Calls, This app, Unknown to this app (with a note that the app does not act on them; approving them is not remembered).
- A section header: a checkbox for all its rows (mixed if only some are checked), the title, "N of M" and a warning icon if a row is risky. A row: checkbox, label, the full capability string (wrapping) and a warning icon if it acts in your name, changes the room for everyone, is hidden from the room or proves your identity.
- Everything is checked at first. Capabilities the widget holds already or gets without asking are not listed.
- A capability the host grants for one use (an OpenID token: the widget asks again for the next one) has "Once" (default) / "Always" in its row, disabled while the row is unchecked; choosing never toggles the row. "Always" grants it whenever the widget asks, without the card: remembered when remembering is on, else while the widget runs.
- The header and the buttons ("Deny all", "Approve N selected") stay in place; only the sections scroll, and the title of the section in view sticks.
- A request that arrives while the card is open joins it: its capabilities are added checked and marked "New"; the choices made so far stay.
- "Approve" is blocked for 3 s after the card appeared or a request added to it (a status line counts down). "Deny all" is never blocked.

## WidgetDevToolBar

A toolbar for a single widget, with information like the driver state (approved capabilities) and a log of the messages.

- It looks technical, like Photoshop, Godot and the browser devtools: less rounded corners and a technical font (not monospace).
- It is docked at the top of the widget by default and can be moved to the bottom, left or right, with the bar at the outer edge. A vertical bar too short for its labels shows icons only.
- A reload button restarts the widget like "Retry" (new iframe and driver); its panels start empty.
- The other buttons open and close panels: the first opens at full width, the second next to it, the third next to those. Opening a fourth closes the oldest one.
- Panels are resized by dragging between them.

### WidgetDevToolMessagesPanel

- A scrollable list of all messages.
- Each message is a box that can be expanded. The collapsed overview only has the most important information:
  - direction
  - action type
  - indicator whether it has been responded to

### WidgetDevToolStatsPanel

- Tiles: actions sent, run duration, events shared with the widget, events sent from the widget.
- Characters sent over the widget API since the widget started: total, to widget and from widget. Pressing one of the three numbers shows its graph.
- The graph has one bar per 5 s up to now, as many as fit (at most 5 minutes), in one color per graph.
- A bar's value is written along it (rotated), above the bar where it fits, else inside it, else only in the hover tooltip, which shows both directions; the hovered bar is outlined.
- Numbers are short (970, 4.4k, 12k, 1.2M). The y axis has at most 4 steps of 1, 2, 2.5 or 5 × 10ⁿ, at least 22px apart.
- No text overlaps at any panel size; the chart header wraps in narrow panels.

### WidgetDevToolDriverPanel

An overview of the driver side:

- approved capabilities (with a way to revoke them and to add more); a one-use one is marked "once", one chosen "Always" is auto-approved
- buttons to mock a driver action: update theme, update language, ... (just add a couple for now, with a TODO)

### WidgetDevToolConsolePanel

A copy of the widget's browser console, to make it easy to debug with only the widget's log messages.

## PictureInPicturePanel

Widgets that are set to always on screen are rendered in a floating container, the PictureInPicturePanel, while their tab is not shown:

- Setting a widget to always on screen first only adds the pin icon to its tab. The widget stays where it is.
- Moving away from the widget (for example by opening another tab) opens it in the PictureInPicturePanel.
- Opening the widget again (pressing its tab, the one with the pin icon) closes it in the PictureInPicturePanel.

The container:

- The container is a list of widgets next to each other. A button switches between horizontal and vertical stacking.
- There is no limit on the number of always-on-screen widgets. The container shows 4 boxes; the other widgets are listed in an overflow menu of the container.
- The container can be resized, up to almost the size of the screen, so there is enough space for the devtools.
- It has no border. It is just an array of rounded boxes, like the `Usage & Quota`, `Cost & Billing` and `Organization` boxes at the top of the `reference_image` (bigger and a bit more square, but similar).
- When the mouse hovers over the panel, an opaque box appears around all the small boxes. It shows:
  - the room name and the widget name next to each box
  - buttons per widget: jump to widget, close, and close the WidgetDevToolBar (if open)
  - Close stops (kills) the widget. An always-on-screen widget otherwise always stays running. (killing prompts the user with a modal to confirm closing even though the widget still wants to be on screen)
- This larger surrounding box is also the drag area of the floating panel.
- Moving a widget to PiP does not change its WidgetDevToolBar state and layout.

## DevBackend

The DevBackend is a custom in-memory backend. It is implemented as a separate account (part of the multi-account feature, which should be the ideal abstraction).

- Activating it removes all current panels (empty RoomsArea).
- Once active, no Matrix CS API calls are made anymore. Only widget <-> host, with the memory widget driver.
- The SidePanel opens with the [Dev tools](#dev-tools).
- The RoomsArea keeps the same design, but only shows the rooms that were created in the Dev tools or copied over from a RoomOverview.
- It is entered and left by switching accounts in the AccountView or with the text button at the bottom of the Dev tools. Leaving restores the panels of the account (their widgets reload); the Dev tools stay open while dev tools are enabled.

## Dev tools

One of the [SidePanel](#sidepanel) views: the tools of one room at a time. The rooms are not tabs but a dropdown next to the room name and ID (where "Core product" is in the `reference_image`).

- With a Matrix account, the dropdown lists the rooms open in a room panel, left to right. It starts on the room of the focused room panel and keeps a picked room while it is open. With no room open: "No room open" and "New room panel".
- While the [DevBackend](#devbackend) is active, it is the DevBackendView: one page per mocked room, and the last entry of the dropdown adds a room.

Each room has these sections:

- State
  - shortcuts: edit name, edit description, add member (DevBackend)
  - send state (also delayed), with a menu of predefined forms like "send event". The default is the widget form; the last option is raw JSON (type, state key, content).
    - widget: event type (`m.widget`, `org.matrix.msc4411.widget` or legacy `im.vector.modular.widgets`), widget ID, name, URL and, unless legacy, "uses the widget API". Prefilled with the test widget of that kind
    - Element Call: a legacy `m.call` widget as Element Web describes its call widget, from the Element Call URL (default call.element.io), the call intent and the widget ID
  - current state (explore by type and key), with an edit button per state event
- Timeline
  - send event (also delayed), with a menu of predefined forms so that users don't need to know the raw JSON: message, sticker, RTC member, image/audio. The default is a predefined form; the last option is raw JSON with a text editor.
  - "Scheduled": the delayed events sent from here (with the DevBackend also those of widgets): send now, restart, cancel
  - the list of events, newest first; with a Matrix account the ones the session holds, then "Load older events"

**Sending to a real room**

- Everything is sent as you, which a line above the sections says (the DevBackend sends as any user). A refusal (no permission, no delayed events on the homeserver) is a toast; the form keeps its draft.
- Changing the room's configuration asks first: power levels, join rules, encryption, history visibility, guest access, server ACL, tombstone, create event, canonical alias, another user's membership, replacing a widget.

**Tools** (DevBackend)

What is not per room is in tool boxes below the room box: the "Client Backend Tool" and the "Media Backend Tool".

- Below the room box each tool is a button. Pressing it turns it into the tool's box (resized by dragging between it and the room box); its minimise button turns it back. One tool box is open at a time.
- Client Backend Tool, with collapsible sections like the room box:
  - Widget host behavior, for all mocked rooms: auto-approve capabilities (OpenID tokens too), remember capabilities, fail sends (every send of a widget is answered with an error)
  - To-device messages: sending and reading
- Media Backend Tool: upload media, a list of all media (including media uploaded by widgets), and buttons to copy the MXC URI of each item. Its button shows the number of files.

**Switch and leave**

At the very bottom of the view: "Leave DevBackend" while it is active (not without a Matrix account to go back to), "Switch to the DevBackend" while it is enabled and not active, each followed by an icon. Just a text button, styled like a link (the icon may be colored). No header and no box: it should not draw attention.

## Login page

A simple fullscreen login. It allows skipping the login, which immediately ends up in the DevBackend (and enables dev tools and the DevBackend).

# Custom behavior

- Collapsing the LeftBar while the only tab open is a widget, and shown, renders the widget fullscreen: no rounded containers anymore.
  - The room header stays (it is important information); the tab, the + button and the close button are not shown. Selecting the room name ends it.
  - The header spans the full page: no rounded corners, no padding for the room view.

# Required visualisations

The mockups needed to review the full design. Each leaf is one state to draw. Do all of them in one theme, plus one overall screen in the other theme.

- App
  - Login page (with the skip login option)
  - Default screen: LeftBar + one room panel
  - DevBackend active: construction-fence background + DevBackend badge
  - App info modal
  - Fullscreen: LeftBar collapsed, one widget, no rounded containers: room header without tab and + button / header hovered
  - Narrow window: SidePanel overlays, one room panel
- LeftBar
  - Expanded: dev tools disabled / enabled (Dev tools button) / DevBackend active (button highlighted) / active and hovered ("Dev tools" tooltip)
  - Collapsed with toast
  - Collapsed, expand icon revealed (after Esc)
- SidePanel
  - Closed
  - AccountView
    - One account
    - Several accounts, DevBackend enabled (switch list at the bottom with the DevBackend, ending with "Add account")
    - DevBackend mode (full account list)
    - Device not verified: the box / after a failure (with the reason) / verified ("Done")
      - With another device: waiting for it / comparing the emoji / waiting for it to confirm
      - Recovery key: entering it / checking it / refused
  - Settings
    - Both switches off / both on / DevBackend active (its switch locked), dev tools off
  - Room list: the room picker / next to the room panels (LeftBar button pressed)
  - Dev tools of a Matrix account
    - No room open / room dropdown open (the rooms of the room panels) / reading the room: loading, failed
    - State: "sent as you", no "add member" / Timeline: fixed sender, a scheduled event, "Load older events"
    - Next to the room panels (LeftBar button pressed), "Switch to the DevBackend" at the bottom / confirming a change of the room's configuration
  - Dev tools while the DevBackend is active (DevBackendView)
    - No rooms yet
    - Room dropdown open (rooms + add room)
    - State: shortcuts, send state with the widget form / the Element Call form / as raw JSON, state explorer, edit state
    - Timeline: send event with a predefined form, send event as raw JSON, send delayed event, event list
    - Tools: collapsed (the "Client Backend Tool" and "Media Backend Tool" buttons) / Client Backend Tool open below the room box (resize handle, minimise button): WidgetHostBehavior, To-device messages / Media Backend Tool open (media list)
    - "Leave DevBackend" text button at the bottom (part of every DevBackendView state)
- PictureInPicturePanel
  - Idle: borderless boxes, 1 widget / 4 widgets
  - More widgets than fit: overflow menu closed / open
  - Stacked horizontal / vertical
  - Hover: surrounding box with room name, widget name and buttons
  - Enlarged, with the WidgetDevToolBar of one widget open
- RoomsArea
  - Layout
    - One room panel
    - Several room panels next to each other
    - Shifted by an open SidePanel
  - Room panel (empty): the room picker
    - Recent widgets (one of them open in a tab), recent rooms, all rooms
    - No recents yet: all rooms only
    - Searching: scrolled to the search field, the matches below
    - No rooms
  - RoomView (1)
    - Tab bar
      - Room name selected, no widget tab (name, number of widgets and users)
      - WidgetTab active / room name selected
      - Tab marked as always on screen (pin icon)
      - Timeline tab active
      - More tabs than fit
    - RoomOverview
      - No widget open, dev tools disabled
      - A widget open in this panel ("jump to tab"), a local widget, dev tools and DevBackend enabled ("Add widget", copy to DevBackend)
      - Add widget: the widget form, only in this host / a pasted state event / to the room, refused (the reason)
    - RoomTimeline
      - Events of every kind, one showing its JSON, "Load older events"
      - Start of the room reached
      - Loading / failed to load
    - WidgetTab
      - WidgetView
        - Loading / failed to load
        - Capability prompt: summary and sections / a long list, scrolled / a second request joined, "Approve" blocked / one OpenID capability, "Once", "Approve" blocked
        - Dev tools: no (full widget)
        - Dev tools: yes
          - Bar only, docked top / bottom / left / right
          - One panel open (full width)
          - Two and three panels next to each other
          - Fourth panel opened: the oldest one closes
          - WidgetDevToolMessagesPanel: list, one message expanded
          - WidgetDevToolStatsPanel: total graph / one direction in a narrow panel
          - WidgetDevToolDriverPanel
          - WidgetDevToolConsolePanel
  - RoomView (2)
    - A different room next to RoomView (1)
    - The same room as RoomView (1) (Ctrl+Shift+N): its RoomOverview offers "jump to tab" and "move widget here"

# Details

Notes for the implementation. They add to the design above, they do not change it.

**Keyboard**

- The host is a browser app, and browsers do not let a page override Ctrl+N, Ctrl+Shift+N or Ctrl+W. Bind alternatives that work in a tab (suggestion: Alt+N, Alt+Shift+N, Alt+W), ignored while typing in a text field, and show the shortcut in the button tooltips.
- While a widget iframe has focus, the host does not receive key events (including Escape). Also reveal the LeftBar expand button when the mouse reaches the screen edge.

**Widgets are iframes**

- Moving an iframe in the DOM reloads it. To move a widget between a tab and the PictureInPicturePanel without a reload, every iframe stays where it is in one persistent layer and is displayed through a shadow DOM slot where the view shows the widget.
- Only absolute `http:` / `https:` widget URLs are embedded, for both widget kinds (a legacy URL is checked as its template, so one starting with `$variable` is refused); any other widget is listed disabled, with the reason. The "Add widget" forms refuse such a URL; a stored local widget is checked again.
- A local widget's key is `local:` plus its type and state key, so it never shares remembered capabilities with a room widget of the same ID; they are forgotten when its URL (of a legacy widget also its `data`, the values of the URL's variables) changes or it is removed. Local widgets are persisted with the account's layout and deleted on logout (the DevBackend's are kept in memory).
- The host cannot read the console of a cross-origin iframe. The WidgetDevToolConsolePanel needs the widget side (SDK or compat wrapper) to forward its logs.

**Dev tools forms**

- The Element Call form writes `im.vector.modular.widgets` with `type: "m.call"`, `waitForIframeLoad: false` and the URL `<Element Call URL>#?intent=…&roomId=$matrix_room_id&userId=$matrix_user_id&deviceId=$org.matrix.msc3819.matrix_device_id&baseUrl=$org.matrix.msc4039.matrix_base_url&lang=$org.matrix.msc2873.client_language&theme=$org.matrix.msc2873.client_theme`. The compat wrapper fills in the variables and adds `widgetId` and `parentUrl`.

**Theming**

- Define semantic color tokens (surface, border, text, primary, highlight, danger, ...) as CSS variables; components never use raw colors. Follow `prefers-color-scheme`, with a manual override.
- Widgets get the theme too: the widget iframe uses the theme's color scheme (so `prefers-color-scheme` inside a widget is the theme), and a theme change is pushed as `update_theme` to widgets that hold that capability.
- Use one spacing scale and one radius scale. The dev tools use a smaller radius from the same scale.
- Keep the construction-fence background low contrast and static. Add a persistent "DevBackend" badge (in the LeftBar; floating at the top while it is collapsed, also in fullscreen), so the mode is not signalled by the background alone.

**Accessibility**

- WCAG AA contrast in both themes and visible focus rings.
- Tabs follow the ARIA tabs pattern, the room name being the first tab (arrow keys switch, middle click closes).
- Icon-only buttons get a tooltip and an `aria-label`.
- Never rely on color alone (e.g. message direction: icon + color).
- Respect `prefers-reduced-motion`.

**Panels and resizing**

- Every resizable panel has a minimum size. Drag handles have a hit area of at least 8px, are keyboard operable and reset on double click.
- Persist panel sizes, open tabs and the dev tool dock position per account.
- Widget tabs that do not fit scroll horizontally behind the room name, with an overflow menu listing them.
- In narrow windows (below ~900px) the SidePanel overlays the RoomsArea instead of shifting it, and only one room panel is visible at a time.

**States and feedback**

- Every list has an empty, a loading and an error state.
- Long room and widget names are truncated, with the full name in a tooltip.
- A widget that fails to load shows the error and a retry button inside its tab.
- Confirm actions that lose state: activating the DevBackend (closes all panels; restore them when switching back), logging out, revoking capabilities. One that cannot be undone (a change of a real room's configuration) gets an alert icon and a danger button.
- The recovery key is a secret: its field has no autocomplete and no spell check, and it is never stored, logged or kept in the view model.

**Performance**

- Virtualize the message and event lists. Cap the message log and offer a clear button.
- Pause the stats graph while its panel is hidden.
