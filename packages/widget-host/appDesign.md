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
- A room list button. Placeholder: it does nothing for now, the room list is reachable through a new, empty room panel.
- A DevBackend button (only if dev tools are enabled). It activates the [DevBackend](#devbackend). While the DevBackend is active, pressing it again leaves the DevBackend (tooltip on hover: "Leave DevBackend"). All the view state will be cached however. pressing it again "reverts the leave entirely (same rooms/widgets open) widgets reload however"
- A settings button. It opens [Settings](#settings).
- The user avatar. It opens the [AccountView](#accountview). While the DevBackend is active, it is the DevBackend icon.
- A collapse button.

Collapsing the bar shows a toast: "Press Esc to show the expand button". Pressing Escape only reveals the expand icon; pressing that icon shows the bar again.

## SidePanel

One panel next to the LeftBar, positioned and styled like the "Core product" panel in the `reference_image`. It hosts one of DevBackendView, AccountView or Settings. When it opens, the RoomsArea is shifted to the side.

### AccountView

- The current account at the top: avatar and the default account information.
- Buttons:
  - Manage account & devices (opens the MAS account page)
  - Copy Matrix URI
  - Log out
- At the bottom, a list to switch to the other logged-in accounts: "switch to: `<Avatar>` `<AccName>`", with "switch to" very small above the name and an arrow icon on the right.
  - The last entry of the list is "Add account" (opens the OIDC login page).

In DevBackend mode the account icon is the DevBackend icon, and the view shows the full list of accounts with buttons: "switch to `<AccName>`". "Add account" is again the last entry of the list.

### Settings

Current settings:

- Enable dev tools. If enabled, all dev tool options are visible; if not, they are fully hidden:
  - the DevBackend button in the LeftBar
  - the WidgetDevToolBar (and the overflow button that opens it) in the tabs

### DevBackendView

The tools to create and edit the mocked rooms of the DevBackend. It is only shown while the [DevBackend](#devbackend) is active. See the full section: [DevBackendView](#devbackendview-1).

## RoomsArea

The RoomsArea is the main area of the logged-in view. It allows opening multiple room panels next to each other.

- A room panel is empty by default: it shows a list of the last opened widgets with their associated rooms. A "show all rooms" toggle switches to the full room list with a room search bar.
  - The empty disign uses a similar style than the "Overview" section of `reference_image`
    - no title however
    - tiles for the recent rooms similar to the `reference_image` (but a bit mroe spaceing + centered)
- By default there is one panel per room.
- Ctrl+N opens a new panel on the right with the list of recents, Ctrl+Shift+N one showing the same room.
- Ctrl+W closes the active tab of the focused panel; in a panel without a widget tab it closes the panel.

## RoomView

A room view is a tabbed container, shown inside a room panel. Each tab contains an open widget or a native view (see [Tabs](#tabs)). This is the main way to open multiple widgets per room.

- If no widget is open, the room shows the available widgets as nice, large, centered tiles.
- Once a widget is selected, it is rendered as the first tab.
- A + button in the tab bar opens a new tab with the same widget list. Widgets that are already open are grayed out, with buttons overlaying the tile:
  - "jump to tab"
  - "move widget here", if the widget is open in another room view: it closes the tab there and opens the widget in this room view.
- A widget runs only once per account, also when two room views show the same room.
- The room header contains the room name and the number of widgets and users. Pressing it opens the [RoomOverviewTab](#roomoverviewtab) (or switches to it if it is already open).

## Tabs

There are two kinds of tabs with slightly different designs:

- **WidgetTab**: contains a widget. The default view is just the full widget. The tab name is the widget name, and the tab shows the widget icon/avatar if available.
- **NativeTab**: a view rendered by the host instead of a widget, like the RoomOverviewTab (and devtools or a timeline in the future). Native tabs get slightly transparent labels.

Every tab has a close button. With dev tools enabled, a WidgetTab also has an overflow button (three dots) that opens the [WidgetDevToolBar](#widgetdevtoolbar).

A widget that is set to always on screen gets a marker on its tab: a pin icon (see [PictureInPicturePanel](#pictureinpicturepanel)).

## RoomOverviewTab

A NativeTab with the default room information, in a pretty layout that follows all best practices:

- Avatar
- Member list
- Description
- Encryption status
- Widget list (pressing a widget opens it in a new tab)
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

A nice summary:

- number of actions sent
- run duration
- number of events shared with the widget
- number of events sent from the widget
- characters sent over the widget API (a graph with two lines in different colors, one per direction)

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
- The RoomsArea keeps the same design, but only shows the rooms that were created in the DevBackendView or copied over from a RoomOverviewTab.
- There are three ways to leave it:
  - switching to an account in the AccountView
  - the "Leave DevBackend" text button at the bottom of the DevBackendView
- Pressing the devBackend button in the left bar DOES not leave (this might be in conflict with toher parts here. update them. This is a last minitue decision and this statement here wins)
  - it closes the devBackend side bar
  - the leave button below the devpanel is enough
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
- WidgetHostBehavior
  - auto-approve capabilities
- To-device messages: sending and reading

**Media**

Media is a special case, as it is not per room. It gets its own box:

- The per-room box does not go all the way to the bottom of the SidePanel. There is enough space below it for a button: "Media Backend Tool".
- Pressing the button creates a second box below, very similar to the per-room one. The two boxes can be resized by dragging between them.
- The header of this box has a minimise/hide button to collapse it again (full space for the per-room box).
- Content: upload media, a list of all media (including media uploaded by widgets), and buttons to copy the MXC URI of each item.

**Leave**

At the very bottom of the view, below the media box: "Leave DevBackend" followed by a leave icon. It is just a text button, styled like a link (the icon may be colored). No header and no box: it should not draw attention.

Remove the leave options in case there is no logged in account to fallback to.

## Login page

A simple fullscreen login. It allows skipping the login, which immediately ends up in the DevBackend (and enables dev tools).

# Custom behavior

- Collapsing the LeftBar while only one widget is open renders the widget fullscreen: no rounded containers anymore.
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
  - Expanded, dev tools enabled (DevBackend button), DevBackend inactive / active / active and hovered ("Leave DevBackend" tooltip)
  - Collapsed with toast
  - Collapsed, expand icon revealed (after Esc)
- SidePanel
  - Closed
  - AccountView
    - One account
    - Several accounts (switch list at the bottom, ending with "Add account")
    - DevBackend mode (full account list)
  - Settings
    - Dev tools disabled / enabled
  - DevBackendView
    - No rooms yet
    - Room dropdown open (rooms + add room)
    - Room page
      - State: shortcuts, send state with the widget form / the Element Call form / as raw JSON, state explorer, edit state
      - Timeline: send event with a predefined form, send event as raw JSON, send delayed event, event list
      - WidgetHostBehavior
      - To-device messages
    - Media box
      - Collapsed (only the "Media Backend Tool" button)
      - Open below the room box (resize handle, minimise button, media list)
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
  - Room panel (empty)
    - List of recent widgets
    - No recents yet
    - All rooms, with search bar
  - RoomView (1)
    - Room header (name, number of widgets and users)
    - No widget open: widget tiles
    - Tab bar
      - WidgetTab / NativeTab, active / inactive
      - Tab marked as always on screen (pin icon)
      - More tabs than fit
    - Tab (1): new tab
      - Widget list, opened widgets grayed out with "jump to tab"
    - Tab (2): WidgetTab
      - WidgetView
        - Loading / failed to load
        - Dev tools: no (full widget)
        - Dev tools: yes
          - Bar only, docked top / bottom / left / right
          - One panel open (full width)
          - Two and three panels next to each other
          - Fourth panel opened: the oldest one closes
          - WidgetDevToolMessagesPanel: list, one message expanded
          - WidgetDevToolStatsPanel
          - WidgetDevToolDriverPanel
          - WidgetDevToolConsolePanel
    - Tab (3): RoomOverviewTab
      - Dev tools disabled / enabled (copy to DevBackend)
  - RoomView (2)
    - A different room next to RoomView (1)
    - The same room as RoomView (1) (Ctrl+Shift+N): opened widgets offer "jump to tab" and "move widget here"

# Details

Notes for the implementation. They add to the design above, they do not change it.

**Keyboard**

- The host is a browser app, and browsers do not let a page override Ctrl+N, Ctrl+Shift+N or Ctrl+W. Bind alternatives that work in a tab (suggestion: Alt+N, Alt+Shift+N, Alt+W), ignored while typing in a text field, and show the shortcut in the button tooltips.
- While a widget iframe has focus, the host does not receive key events (including Escape). Also reveal the LeftBar expand button when the mouse reaches the screen edge.

**Widgets are iframes**

- Moving an iframe in the DOM reloads it, and a shadow DOM does not prevent that. To move a widget between a tab and the PictureInPicturePanel without a reload, keep every iframe mounted in one persistent layer and position it over its current slot.
- The host cannot read the console of a cross-origin iframe. The WidgetDevToolConsolePanel needs the widget side (SDK or compat wrapper) to forward its logs.
- To-device messages are account-scoped, not room-scoped. The section may fit better next to the media box than in the per-room page.

**DevBackend forms**

- The Element Call form writes `im.vector.modular.widgets` with `type: "m.call"`, `waitForIframeLoad: false` and the URL `<Element Call URL>#?intent=…&roomId=$matrix_room_id&userId=$matrix_user_id&deviceId=$org.matrix.msc3819.matrix_device_id&baseUrl=$org.matrix.msc4039.matrix_base_url&lang=$org.matrix.msc2873.client_language&theme=$org.matrix.msc2873.client_theme`. The compat wrapper fills in the variables and adds `widgetId` and `parentUrl`.

**Theming**

- Define semantic color tokens (surface, border, text, primary, highlight, danger, ...) as CSS variables; components never use raw colors. Follow `prefers-color-scheme`, with a manual override.
- Use one spacing scale and one radius scale. The dev tools use a smaller radius from the same scale.
- Keep the construction-fence background low contrast and static. Add a persistent "DevBackend" badge, so the mode is not signalled by the background alone.

**Accessibility**

- WCAG AA contrast in both themes and visible focus rings.
- Tabs follow the ARIA tabs pattern (arrow keys switch, middle click closes).
- Icon-only buttons get a tooltip and an `aria-label`.
- Never rely on color alone (e.g. message direction: icon + color).
- Respect `prefers-reduced-motion`.

**Panels and resizing**

- Every resizable panel has a minimum size. Drag handles have a hit area of at least 8px, are keyboard operable and reset on double click.
- Persist panel sizes, open tabs and the dev tool dock position per account.
- Tabs that do not fit scroll horizontally, with an overflow menu listing all tabs.
- In narrow windows (below ~900px) the SidePanel overlays the RoomsArea instead of shifting it, and only one room panel is visible at a time.

**States and feedback**

- Every list has an empty, a loading and an error state.
- Long room and widget names are truncated, with the full name in a tooltip.
- A widget that fails to load shows the error and a retry button inside its tab.
- Confirm actions that lose state: activating the DevBackend (closes all panels; restore them when switching back), logging out, revoking capabilities.

**Performance**

- Virtualize the message and event lists. Cap the message log and offer a clear button.
- Pause the stats graph while its panel is hidden.
