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
- A DevBackend button (only if dev tools are enabled). It activates the [DevBackend](#devbackend). While the DevBackend is active, it opens and closes the DevBackendView (tooltip: "DevBackend panel").
- A settings button. It opens [Settings](#settings).
- The user avatar. It opens the [AccountView](#accountview). While the DevBackend is active, it is the DevBackend icon.
- A collapse button.

Collapsing the bar shows a toast: "Press Esc to show the expand button". Pressing Escape only reveals the expand icon; pressing that icon shows the bar again.

## SidePanel

One panel next to the LeftBar, positioned and styled like the "Core product" panel in the `reference_image`. It hosts one of AccountView, Settings, the Room list or, while the [DevBackend](#devbackend) is active, the [DevBackendView](#devbackendview) (the tools to create and edit its mocked rooms). When it opens, the RoomsArea is shifted to the side.

### AccountView

- The current account at the top: avatar and the default account information, including whether this device is verified. That state follows the session, whatever changes it.
- Buttons: Manage account & devices (opens the MAS account page), Copy Matrix URI, Log out.
- At the bottom, a list to switch to the other logged-in accounts: "switch to: `<Avatar>` `<AccName>`", with "switch to" very small above the name and an arrow icon on the right. Its last entry is "Add account" (opens the OIDC login page).

While this device is not verified (other devices share the keys of encrypted rooms only with verified devices), a "Verify this device" box under the account card offers two ways:

- With another device: the request goes to the account's other devices. Once one accepts, both show the same 7 emoji: "They match" / "They don't match". After "They match", wait for the other device.
- With the recovery key: one field and "Verify". A refused key stays in the form, with the reason.
- While a step runs, the box replaces the device details and the buttons, and every step can be cancelled. Closing the AccountView does not stop it (a toast reports how it ended); activating the DevBackend does.
- A verification that fails (cancelled, timed out, the emoji differ) shows the box again, with the reason. One that succeeds says so until "Done".

In DevBackend mode the account icon is the DevBackend icon, and the view shows the full list of accounts with buttons: "switch to `<AccName>`". "Add account" is again the last entry of the list.

### Settings

- Enable dev tools. If enabled, all dev tool options are visible; if not, they are fully hidden:
  - the DevBackend button in the LeftBar
  - the WidgetDevToolBar (and the overflow button that opens it) in the tabs

### Room list

The [room picker](#room-picker), titled "Rooms". A pick opens in the room panel that shows the room, else in the focused empty room panel, else in a new room panel next to the focused one. In a narrow window the SidePanel closes after a pick.

## RoomsArea

The RoomsArea is the main area of the logged-in view. It allows opening multiple room panels next to each other.

- By default there is one panel per room.
- Ctrl+N opens a new panel on the right with the [room picker](#room-picker) (a pick turns it into that room), Ctrl+Shift+N one showing the same room.
- Ctrl+W closes the shown widget tab of the focused panel, and a panel without a widget tab.

### Room picker

No title. From top to bottom, a group without entries is left out:

- Recent widgets: tiles of the last 4 opened widgets (name and room). Pressing one opens the widget as a tab of its room. A widget that is open in a tab is marked "open"; pressing it jumps to that tab.
- Recent rooms: tiles of the last 4 rooms opened in a room panel (number of widgets and members). Pressing one opens the room on its RoomOverview.
- All rooms: a search field and the list of all rooms. When the field gets the focus or a query, it scrolls to the top, so the matches show right under it; the tiles stay. Enter opens the first match, Escape clears the search.

## RoomView

A room view is a tabbed container, shown inside a room panel. Its first tab is the room name, which shows the [RoomOverview](#roomoverview); every other tab holds an open widget (see [Tabs](#tabs)). This is the main way to open multiple widgets per room.

- A room opens on its RoomOverview and returns to it when its last widget tab is closed. Closing another tab shows its neighbour.
- A widget opened from the RoomOverview becomes a new tab at the end.
- The + button of the tab bar selects the room name.
- A widget runs only once per account, also when two room views show the same room.

## Tabs

- **Room name**: avatar, room name and the number of widgets and users. It cannot be closed. Unselected it is plain header text; selected it looks like an active tab.
- **WidgetTab**: contains the full widget. The tab name is the widget name, with the widget icon/avatar if available. It has a close button and, with dev tools enabled, an overflow button (three dots) that opens the [WidgetDevToolBar](#widgetdevtoolbar).

A widget that is set to always on screen gets a marker on its tab: a pin icon (see [PictureInPicturePanel](#pictureinpicturepanel)).

## RoomOverview

What the room name shows: the room in a pretty layout that follows all best practices.

- Avatar, name, ID and description
- Widget list, first and full width. Pressing a widget opens it. A widget that is already open is grayed out, says where it is open and offers:
  - "jump to tab"
  - "move widget here", if it is open in another room view: it closes the tab there and opens the widget in this room view.
- Encryption status
- Member list
- Devtools (only if dev tools are enabled). For now just one button: copy to DevBackend.

## WidgetDevToolBar

A toolbar for a single widget, with information like the driver state (approved capabilities) and a log of the messages.

- It looks technical, like Photoshop, Godot and the browser devtools: less rounded corners and a technical font (not monospace).
- It is docked at the top of the widget by default and can be moved to the bottom, left or right, with the bar at the outer edge.
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
- A bar's value is written along it (rotated), above the bar where it fits, else inside it, else only in the hover tooltip, which shows both directions.
- No text overlaps at any panel size; the chart header wraps in narrow panels.

### WidgetDevToolDriverPanel

An overview of the driver side:

- approved capabilities (with a way to revoke them and to add more)
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
- Widgets need to be started in a shadow DOM so that they can be remounted from the room view to the PictureInPicturePanel.

## DevBackend

The DevBackend is a custom in-memory backend. It is implemented as a separate account (part of the multi-account feature, which should be the ideal abstraction).

- Activating it removes all current panels (empty RoomsArea).
- Once active, no Matrix CS API calls are made anymore. Only widget <-> host, with the memory widget driver.
- The app renders the construction-fence background (see [Design](#design)).
- The SidePanel opens with the DevBackendView.
- The RoomsArea keeps the same design, but only shows the rooms that were created in the DevBackendView or copied over from a RoomOverview.
- It is left by switching to an account in the AccountView or with the "Leave DevBackend" text button at the bottom of the DevBackendView, not with the LeftBar button. Leaving restores the panels of the account; their widgets reload.

## DevBackendView

One of the [SidePanel](#sidepanel) views. It has one page per mocked room. The rooms are not rendered as tabs but as a dropdown next to the room name and ID (where "Core product" is in the `reference_image`). The last entry of the dropdown is a + button to add a room.

Each room has these sections:

- State
  - shortcuts: edit name, edit description, add member
  - send state (also delayed), with a menu of predefined forms like "send event". The default is the widget form; the last option is raw JSON (type, state key, content).
    - widget: event type (`m.widget`, `org.matrix.msc4411.widget` or legacy `im.vector.modular.widgets`), widget ID, name, URL and, unless legacy, "uses the widget API". Prefilled with the test widget of that kind
    - Element Call: a legacy `m.call` widget as Element Web describes its call widget, from the Element Call URL (default call.element.io), the call intent and the widget ID
  - current state (explore by type and key), with an edit button per state event
- Timeline
  - send event (also delayed), with a menu of predefined forms so that users don't need to know the raw JSON: message, sticker, RTC member, image/audio. The default is a predefined form; the last option is raw JSON with a text editor.
  - show the list of events

**Tools**

What is not per room is in tool boxes below the room box: the "Client Backend Tool" and the "Media Backend Tool".

- The room box does not go all the way to the bottom of the SidePanel. Below it, each tool is a button.
- Pressing a button turns it into the tool's box; the box and the room box are resized by dragging between them. Only one tool box is open at a time: opening one closes the other.
- The header of a tool box has a minimise button that turns it back into its button.
- Client Backend Tool, with collapsible sections like the room box:
  - Widget host behavior, for all mocked rooms: auto-approve capabilities, auto-approve OpenID tokens, remember capabilities, fail sends (every send of a widget is answered with an error)
  - To-device messages: sending and reading
- Media Backend Tool: upload media, a list of all media (including media uploaded by widgets), and buttons to copy the MXC URI of each item. Its button shows the number of files.

**Leave**

At the very bottom of the view, below the tools: "Leave DevBackend" followed by a leave icon. It is just a text button, styled like a link (the icon may be colored). No header and no box: it should not draw attention.

Remove the leave options in case there is no logged in account to fallback to.

## Login page

A simple fullscreen login. It allows skipping the login, which immediately ends up in the DevBackend (and enables dev tools).

# Custom behavior

- Collapsing the LeftBar while only one widget is open, and shown, renders the widget fullscreen: no rounded containers anymore.
  - The room header stays: it is important information.
  - The + button of the tab bar is not shown by default.
  - The tab is not shown, as only one widget is open.
  - no close button shown
  - also the header spreads to the full page size (no rounded corners on the header as well, no padding for the room view)

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
  - Expanded, dev tools disabled
  - Expanded, dev tools enabled (DevBackend button), DevBackend inactive / active / active and hovered ("DevBackend panel" tooltip)
  - Collapsed with toast
  - Collapsed, expand icon revealed (after Esc)
- SidePanel
  - Closed
  - AccountView
    - One account
    - Several accounts (switch list at the bottom, ending with "Add account")
    - DevBackend mode (full account list)
    - Device not verified: the box / after a failure (with the reason) / verified ("Done")
      - With another device: waiting for it / comparing the emoji / waiting for it to confirm
      - Recovery key: entering it / checking it / refused
  - Settings
    - Dev tools disabled / enabled
  - Room list: the room picker / next to the room panels (LeftBar button pressed)
  - DevBackendView
    - No rooms yet
    - Room dropdown open (rooms + add room)
    - Room page
      - State: shortcuts, send state with the widget form / the Element Call form / as raw JSON, state explorer, edit state
      - Timeline: send event with a predefined form, send event as raw JSON, send delayed event, event list
    - Tools
      - Collapsed (the "Client Backend Tool" and "Media Backend Tool" buttons)
      - Client Backend Tool open below the room box (resize handle, minimise button): WidgetHostBehavior / To-device messages
      - Media Backend Tool open below the room box (media list)
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
      - More tabs than fit
    - RoomOverview
      - No widget open, dev tools disabled
      - A widget open in this panel ("jump to tab"), dev tools enabled (copy to DevBackend)
    - WidgetTab
      - WidgetView
        - Loading / failed to load
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
- Only absolute `http:` / `https:` widget URLs are embedded, for both widget kinds (a legacy URL is checked as its template, so one starting with `$variable` is refused); any other widget is listed disabled, with the reason.
- The host cannot read the console of a cross-origin iframe. The WidgetDevToolConsolePanel needs the widget side (SDK or compat wrapper) to forward its logs.

**DevBackend forms**

- The Element Call form writes `im.vector.modular.widgets` with `type: "m.call"`, `waitForIframeLoad: false` and the URL `<Element Call URL>#?intent=…&roomId=$matrix_room_id&userId=$matrix_user_id&deviceId=$org.matrix.msc3819.matrix_device_id&baseUrl=$org.matrix.msc4039.matrix_base_url&lang=$org.matrix.msc2873.client_language&theme=$org.matrix.msc2873.client_theme`. The compat wrapper fills in the variables and adds `widgetId` and `parentUrl`.

**Theming**

- Define semantic color tokens (surface, border, text, primary, highlight, danger, ...) as CSS variables; components never use raw colors. Follow `prefers-color-scheme`, with a manual override.
- Widgets get the theme too: the widget iframe uses the theme's color scheme (so `prefers-color-scheme` inside a widget is the theme), and a theme change is pushed as `update_theme` to widgets that hold that capability.
- Use one spacing scale and one radius scale. The dev tools use a smaller radius from the same scale.
- Keep the construction-fence background low contrast and static. Add a persistent "DevBackend" badge, so the mode is not signalled by the background alone.

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
- Confirm actions that lose state: activating the DevBackend (closes all panels; restore them when switching back), logging out, revoking capabilities.
- The recovery key is a secret: it is never stored, logged or kept in the view model.

**Performance**

- Virtualize the message and event lists. Cap the message log and offer a clear button.
- Pause the stats graph while its panel is hidden.
