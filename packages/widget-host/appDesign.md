This docuement describes the concepts/views of the host app:
# Design
Get inspired by Ide designs. But make things a bit rounded
![reference_image](https://cdn.dribbble.com/userupload/47290357/file/0f4b08fa1dd0007d68725d26938fc2d4.jpg?resize=1504x1128&vertical=center)

Support light and dark theme. Work with a color palette that can be configured (highlight, dark, primary... the default app color palettes)

The image above shows good concepts:
 - the left bar is a good style and small.
 - The rounded boxes for the different tabs should be taken as inspiration
 - The header bar should go.
 - The overview label would be the room name
 - The different tiles would be removed and replace by the widget (but wihtout the padding widget would span the full area)
 - A matching way how to do tabs in the room box would need to be found
 - The left bar would include a + icon for the ctrl+n action
 - and the user avatar, pressing on it would open a the "core product" panel to do manage devices, settings, logout and switch accounts
 - The left bar would also include a devBackend button
 - The "core product" panel would then open (with the memoryStore panel) and the RoomPanelArea would be shifted to the side. and a construction fence Lighter/darker 45deg horizontal bars would become the background of the app. (on which the panels are shown) This indicates that the widgets are only getting the memory store values.
 - The widget dev panel should look like the current content of the overview:
  - different panels. Pressing a button of the widgetdevtoolbar opens that panel
  - First opens full with, second opens next to it, third also next to it
  - some panels need the full width, they will open on top of them.
  - they can be resized by dragging between them

# Features
 - multi account
 - memory session to mock a full session multiple rooms and all events in them
 - copy exising room for memory store (last X events from timeline + state) to then experiemnt with the room entirely offline
 - tabbed widget panels
 - multiple room panel
 - user device management (via a button that links to the oidc auth service MAS)
 - always on screen support

# Structure
## RoomPanelArea
The room panel area is the main area of the loggen in view. It allows opening multiple rooms next to each other.
 - the room panel is empty by default (showing a list of last opened widgets with their associated rooms is available) a show all rooms toggle switches to the full room list with a room search bar.
 - by default we just open one panel per room
 - ctrl+n opens a new panel on the right with the same initial view (list of recents)
 - shift+ctrl+n opens a panel with the same room to the right

## RoomView:
  - A room view should become a tabbed container. Each tab contains an open widget. (or default views, like devtools or a timeline future)
    - If no widget is open the room will just show the available widgets (as nice large tiles, centered)
    - once widget is selected, we will render the widget as the first tab
    - a + button in the tab bar will open a new tab with the list of widgets that are not yet open (opened ones are grayed out. with a jump to tab button overlaying the tile)
    - this is the main way how we can open multiple widgets per room
    - the room header contains the room name and the number of widgets and users.
      - pressing the header opens the custom room overview tab (if it is already open it switches to it)
    - ctrl + w closes the current tab

## RoomOverviewTab
A NativeTabs that can be rendered instead of one of the widgets containing default room info (it has a pretyy layout considering all best practices)
 - avatar
 - member list
 - description
 - encryption status
 - widget list (pressing one here also opens a new tab for them)
 - Devtools
  - If active for now it only has one button: copy to DevBackend

## WidgetTab
A RoomView is made out of multiple WidgetTabs of those tabs.
 - The default view of a tab is just the full widget
 - A tab has a close button and an overflow button (3dots) the tab name is the widget name
  - close is equivalent to ctrl+w (closes the tab)
  - the three dots open the WidgetDevToolBar
 - There are WidgetTabs and NativeTabs (like the RoomOverviewTab) they get slightly different tab designs. Native tabs get slightly transparent labels
 - A tab shows the widget icon/avatar if available
 -
## WidgetDevToolBar
A tool bar at the top of the widget. It has information like the driver state (approved capabilities)
and a log of the messages. It looks very technical. (take inspartion form photoshop, godot, browser devtools, less rounded corners for seperation. Different font (no monospace but more technical))
 - It has options to move to the left/right (as browser devtools have them)
 - The bar just has buttons to open and close specific panels
 -
### WidgetDevToolMessagesPanel
 - a list of all messages scrollable
 - each message is a box, can be expanded overview onlly has the most important:
  - direction
  - action type
  - indicator if it is already responded
### WidgetDevToolStatsPanel
 - a nice summary of things
  - number of actions send
  - run duration
  - amount of events that were shared to the widget
  - events sent from the widget
  - characters send over widget api (a graph two lines both directions different colors)
### WidgetDevToolDriverPanel
 - The overview of the driver side
  - approved capabilities (and a way to revoke them, add more)
  - Buttons to mock a driver action: update theme, update language, ... (just add a couple for now with a TODO)
### WidgetBrowserConsole
A copy of the widgets browser console.
To make it easy to debug just the widget log messages.

## DevBackend

The dev backend is a custom backend. Activating it will remove all current panels (empty `RoomPanelArea`) It is implemented as a seperate account (part of the multi account feature, this should be the ideal abstraction)

Once active we do not do any matrix cs api calls anymore. Only widget <-> host with memory widget driver.

We render the custom background of the main app (as explained in #Design)

The left panel will open the DevBackendView

Once we are in `DevBackend` mode we will still show the same design for the `RoomPanelArea`, but we will of course only see the rooms we have created via the DevBackendView (or copied over from the RoomOverviewTab)

## DevBackendView
This is positioned as in the view shown in the `reference_image` named Core product.
It has tabs at the top for each room we want to Mock.
The tabs are not rendered as scrollable tabs but as a dropdown list next to the room name and id ("Core Product" in the `reference_image`)
At the bottom of this list there is a + button to add a room.

Each room than has a section for
 - State
  - Edit name, edit description add member shortcuts
  - send state
  - send delayed state
  - current state (explore by type, key)
  - edit state (via edit button next to the current state explorer)
 - timeline
  - send event
    - with a menu to show default forms. So that users dont need to know the raw json (default is that the user chooses a predefined from, one of the options is raw json with a text editor)
      - message event
      - sticker event
      - rtc member event
      - image/audio event
  - show list of events
  - send delayed events
 - WidgetHostBehavior
  - auto approve capabilites
 - sending and reading to-device messages
 - media
  - updoad media (and a list of all media uplaoded by widgets)
  - and buttons to copy the media mxid

**Media design**
this is a bit of a special case as its not per room. So this section should get its own box.
 - The main PerRoom DevBackend does not go fully to the bottom of the view
 - there is enough space for a button below it "Media Backend Tool".
 - Pressing the button creates a second box very similar to the "Core product" one but just below. The two boxes can be resized by dragging between them.
 - the header of this box has a minimise/hide button to collapse it again (full space for the tabbed room dev backend)

Of course it also lists all the rooms we have added via the room overview tab

## PictureInPicturePanel
A widget which is set to always on screen will get a custom marker on the tab (pin icon and darker border)
The client will render it inside a floating widget container. This widget container is a horizontal list of widgets. It can grow up to 4 widgets. The container can get resized. the widgets are next to each other. (there is a button to stack horizontal/vertical).
It is a normal pip view.

Widgets need to be started in a shadow dom so that they can be remounted from the room view to the PictureInPicturePanel. PictureInPicturePanel has no border. But is just a array of rounded corner boxes (See the image in `# Design` `reference_image`). Like the `Usage & Quate` `Cost & Billing` `Organization` boxes at the top (bigger and a bit more square but similar)
Once the mouse hovers over the PictureInPicturePanel it will show an opaque box around all the small boxes with the room name and the widget name nex to each box.
An buttons: jump to widget, close, and a button to close the WidgetDevToolBar if open.
The WidgetDevToolBar state and layout will not be changes (when moving to PiP mode)
the larger surrounding box is used as the drag area for the Floating PictureInPicturePanel.

The container can be made almost as big as the screen to have enough space for the devtools.

## Login page
The login page is a simple fullscreen login. It allows to skip login and the immediately end up in devBackendMode.

## LeftBar
See the most left bar in `reference_image`. It contains
 - a settings button
 - A user button to go to AccountView
 - a collapse button.
 - And an icon in the top left corner which opens a modal explaingin what this app is.
 - If devtools are enable a dev button
 - A room list buttont that does nothing for now (room list is accessible through a new Empty RoomView)
The collapse button shows a toast saying: press escape to show the bar again
Pressing escape will only show the hide collapse icon. Pressing the icon will then show the bar again.

### AccountView
The account view opens in the same panel as the DevBackendView.
It has all logged in accounts at the top.

It will show
 - the avatar at the top
 - the default information
 - buttons to logout and show the OIDC login page
 - copy matrix uri
At the bottom there will be list to switch to other accounts: "switch to: <Avatar> <AccName>" (with swtich to very small obove and an arrow icon on the right)

In dev backend mode it shows the full list of accounts with buttons: "switch to <AccName>"
### Settings
The left bar has a settings icon. Current settings
 - enabled dev tools
  - If this is enabled all the devtool options are visible (if not they are fully hidden)
    - the devBackend in the left bar
    - the dev view of the widgets in the tabs

# Custom behavior
 - collapsing the left bar and only having one widget open renders the widget full screen. No rounded corners containers anymore.
