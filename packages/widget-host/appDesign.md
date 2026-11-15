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
- A matching tab style for the room box still needs to be found.

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
- A DevBackend button (only if dev tools are enabled). It activates the [DevBackend](#devbackend).
- A settings button. It opens [Settings](#settings).
- The user avatar. It opens the [AccountView](#accountview).
- A collapse button.

Collapsing the bar shows a toast: "Press Esc to show the expand button". Pressing Escape only reveals the expand icon; pressing that icon shows the bar again.

## SidePanel

One panel next to the LeftBar, positioned and styled like the "Core product" panel in the `reference_image`. It hosts one of DevBackendView, AccountView or Settings. When it opens, the RoomsArea is shifted to the side.

### AccountView

- The current account at the top: avatar and the default account information.
- Buttons:
  - Manage account & devices (opens the MAS account page)
  - Add account (opens the OIDC login page)
  - Copy Matrix URI
  - Log out
- At the bottom, a list to switch to the other logged-in accounts: "switch to: `<Avatar>` `<AccName>`", with "switch to" very small above the name and an arrow icon on the right.

In DevBackend mode it shows the full list of accounts with buttons: "switch to `<AccName>`".

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
- Ctrl+N opens a new panel on the right with the same initial view (list of recents).
- Ctrl+Shift+N opens a new panel on the right showing the same room.

## RoomView

A room view is a tabbed container, shown inside a room panel. Each tab contains an open widget or a native view (see [Tabs](#tabs)). This is the main way to open multiple widgets per room.

- If no widget is open, the room shows the available widgets as nice, large, centered tiles.
- Once a widget is selected, it is rendered as the first tab.
- A + button in the tab bar opens a new tab with the same widget list. Widgets that are already open are grayed out, with a "jump to tab" button overlaying the tile.
- The room header contains the room name and the number of widgets and users. Pressing it opens the [RoomOverviewTab](#roomoverviewtab) (or switches to it if it is already open).

## Tabs

There are two kinds of tabs with slightly different designs:

- **WidgetTab**: contains a widget. The default view is just the full widget. The tab name is the widget name, and the tab shows the widget icon/avatar if available.
- **NativeTab**: a view rendered by the host instead of a widget, like the RoomOverviewTab (and devtools or a timeline in the future). Native tabs get slightly transparent labels.

Every tab has a close button (equivalent to Ctrl+W). With dev tools enabled, a WidgetTab also has an overflow button (three dots) that opens the [WidgetDevToolBar](#widgetdevtoolbar).

A widget that is set to always on screen gets a marker on its tab: a pin icon and a darker border.

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

- It looks very technical. Take inspiration from Photoshop, Godot and the browser devtools: less rounded corners for separation and a different font (not monospace, but more technical).
- It is docked at the top of the widget by default and can be moved to the left or right (as in the browser devtools).
- The bar itself only has buttons to open and close specific panels:
  - The first panel opens at full width, the second opens next to it, the third next to those.
  - Some panels need the full width; they open on top of the others.
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

Widgets that are set to always on screen are rendered in a floating container, the PictureInPicturePanel.

- The container is a list of up to 4 widgets next to each other. A button switches between horizontal and vertical stacking.
- The container can be resized, up to almost the size of the screen, so there is enough space for the devtools.
- It has no border. It is just an array of rounded boxes, like the `Usage & Quota`, `Cost & Billing` and `Organization` boxes at the top of the `reference_image` (bigger and a bit more square, but similar).
- When the mouse hovers over the panel, an opaque box appears around all the small boxes. It shows:
  - the room name and the widget name next to each box
  - buttons per widget: jump to widget, close, and close the WidgetDevToolBar (if open)
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

## DevBackendView

One of the [SidePanel](#sidepanel) views. It has one page per mocked room. The rooms are not rendered as tabs but as a dropdown next to the room name and ID (where "Core product" is in the `reference_image`). The last entry of the dropdown is a + button to add a room.

Each room has these sections:

- State
  - shortcuts: edit name, edit description, add member
  - send state
  - send delayed state
  - current state (explore by type and key)
  - edit state (via an edit button next to the current state explorer)
- Timeline
  - send event, with a menu of predefined forms so that users don't need to know the raw JSON. The default is a predefined form; one of the options is raw JSON with a text editor.
    - message event
    - sticker event
    - RTC member event
    - image/audio event
  - send delayed events
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

## Login page

A simple fullscreen login. It allows skipping the login, which immediately ends up in the DevBackend (and enables dev tools).

# Custom behavior

- Collapsing the LeftBar while only one widget is open renders the widget fullscreen: no rounded containers anymore.

# Required visualisations

The mockups needed to review the full design. Each leaf is one state to draw. Do all of them in one theme, plus one overall screen in the other theme.

- App
  - Login page (with the skip login option)
  - Default screen: LeftBar + one room panel
  - DevBackend active: construction-fence background + DevBackend badge
  - App info modal
  - Fullscreen: LeftBar collapsed, one widget, no rounded containers
  - Narrow window: SidePanel overlays, one room panel
- LeftBar
  - Expanded, dev tools disabled
  - Expanded, dev tools enabled (DevBackend button), DevBackend inactive / active
  - Collapsed with toast
  - Collapsed, expand icon revealed (after Esc)
- SidePanel
  - Closed
  - AccountView
    - One account
    - Several accounts (switch list at the bottom)
    - DevBackend mode (full account list)
  - Settings
    - Dev tools disabled / enabled
  - DevBackendView
    - No rooms yet
    - Room dropdown open (rooms + add room)
    - Room page
      - State: shortcuts, send (delayed) state, state explorer, edit state
      - Timeline: send event with a predefined form, send event as raw JSON, send delayed event, event list
      - WidgetHostBehavior
      - To-device messages
    - Media box
      - Collapsed (only the "Media Backend Tool" button)
      - Open below the room box (resize handle, minimise button, media list)
- PictureInPicturePanel
  - Idle: borderless boxes, 1 widget / 4 widgets
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
      - Tab marked as always on screen (pin icon, darker border)
      - More tabs than fit
    - Tab (1): new tab
      - Widget list, opened widgets grayed out with "jump to tab"
    - Tab (2): WidgetTab
      - WidgetView
        - Loading / failed to load
        - Dev tools: no (full widget)
        - Dev tools: yes
          - Bar only, docked top / left / right
          - One panel open (full width)
          - Two and three panels next to each other
          - Full-width panel on top of the others
          - WidgetDevToolMessagesPanel: list, one message expanded
          - WidgetDevToolStatsPanel
          - WidgetDevToolDriverPanel
          - WidgetDevToolConsolePanel
    - Tab (3): RoomOverviewTab
      - Dev tools disabled / enabled (copy to DevBackend)
  - RoomView (2)
    - A different room next to RoomView (1)
    - The same room as RoomView (1) (Ctrl+Shift+N)

# Details

Notes for the implementation. They add to the design above, they do not change it.

**Keyboard**

- The host is a browser app, and browsers do not let a page override Ctrl+N, Ctrl+Shift+N or Ctrl+W. Bind alternatives that work in a tab (suggestion: Alt+N, Alt+Shift+N, Alt+W) and show the shortcut in the button tooltips.
- While a widget iframe has focus, the host does not receive key events (including Escape). Also reveal the LeftBar expand button when the mouse reaches the screen edge.

**Widgets are iframes**

- Moving an iframe in the DOM reloads it, and a shadow DOM does not prevent that. To move a widget between a tab and the PictureInPicturePanel without a reload, keep every iframe mounted in one persistent layer and position it over its current slot.
- The host cannot read the console of a cross-origin iframe. The WidgetDevToolConsolePanel needs the widget side (SDK or compat wrapper) to forward its logs.
- To-device messages are account-scoped, not room-scoped. The section may fit better next to the media box than in the per-room page.

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
