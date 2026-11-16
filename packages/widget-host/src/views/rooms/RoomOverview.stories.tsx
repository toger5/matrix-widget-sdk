import type { Meta, StoryObj } from "@storybook/react-vite";

import type { MainViewModel, SettingsViewModel } from "../../appViewModel";
import { LOCAL_WIDGET, ROOMS, mainVm, roomPanel, timelineTab, widgetTab, widgetVm, workspace } from "../fixtures";
import { IconButton } from "../ui/atoms";
import { pretty } from "../ui/forms";
import type { AddWidgetDraft } from "./AddWidgetForm";
import { RoomOverview } from "./RoomOverview";
import { AppFrame, DEV_SETTINGS, SETTINGS, SoloPanel } from "./storyFrame";
import { TabBar } from "./TabBar";

/**
 * The RoomOverview: what the room name tab shows, and where a room opens (so the stories show it
 * inside its room panel). The widget list first, then encryption, members and (DevBackend enabled)
 * the DevBackend card.
 */
const meta: Meta<typeof RoomOverview> = { title: "Rooms/RoomOverview", component: RoomOverview, parameters: { size: [900, 900] } };
export default meta;
type Story = StoryObj<typeof RoomOverview>;

/** Dev tools enabled, the DevBackend disabled: "Add widget", no DevBackend card. */
const DEV_TOOLS_ONLY: SettingsViewModel = { ...DEV_SETTINGS, devBackend: false };

/**
 * `SoloPanel` of a room panel without tabs, with the RoomOverview rendered here (the markup of
 * `RoomView`), so a story can start with the "Add widget" form open.
 */
function AddWidgetPanel({ main, initial }: { main: MainViewModel; initial: Partial<AddWidgetDraft> }) {
  const room = ROOMS.design;
  return (
    <AppFrame>
      <main className="roomsarea">
        <section className="roompanel" style={{ flexGrow: 1 }} aria-label={`Room panel: ${room.name}`}>
          <header className="rp-head">
            <TabBar main={main} settings={DEV_TOOLS_ONLY} panelId="panel-design" roomId={room.id} room={room} roomName={room.name} tabs={[]} />
            <span className="sp" />
            <IconButton icon="x" title="Close panel (Alt+W)" aria-label="Close panel" className="rp-close" />
          </header>
          <div className="rp-body" role="tabpanel">
            <RoomOverview main={main} panelId="panel-design" roomId={room.id} devTools devBackend={false} initialAddWidget={initial} />
          </div>
        </section>
      </main>
    </AppFrame>
  );
}

const empty = roomPanel("design", []);
/**
 * No widget open, dev tools disabled. A room opens here, and comes back here when its last tab is
 * closed. Pressing a widget, or "Open timeline", opens it as a new tab at the end.
 */
export const Plain: Story = {
  render: () => <SoloPanel main={mainVm({ workspaces: { ada: workspace([empty]) }, widgets: {} })} panel={empty} settings={SETTINGS} />,
  parameters: { size: [900, 800] },
};

const withCall = roomPanel("design", [widgetTab("design", "call"), timelineTab("design")], null);
const call = widgetVm("design", "call");
const withLocal = (o: Partial<MainViewModel>) => {
  const main = mainVm(o);
  return { ...main, data: { ...main.data, localWidgets: { [ROOMS.design.id]: [LOCAL_WIDGET] } } };
};
/**
 * A widget open in this panel ("jump to tab"), a local widget, dev tools and DevBackend enabled
 * ("Add widget", "Copy to DevBackend"). Element Call has a tab in this panel: it is grayed out and
 * only offers "jump to tab". The panel has its timeline tab, so the header offers "Show timeline".
 * The local widget comes after the room's widgets and counts in the room name tab; without dev
 * tools it has no edit button. A DevBackend room has no DevBackend card: it is already in the
 * DevBackend.
 */
export const DevTools: Story = {
  parameters: { size: [900, 1000] },
  render: () => <SoloPanel main={withLocal({ workspaces: { ada: workspace([withCall]) }, widgets: { [call.id]: call } })} panel={withCall} settings={DEV_SETTINGS} />,
};

const noWidgets = mainVm({ workspaces: { ada: workspace([empty]) }, widgets: {} });

/**
 * Add widget: the widget form, only in this host. The form replaces the "Add widget" button, at the
 * top of the list. Prefilled with the test widget and the first free ID. Adding does not open the
 * widget; it appears in the list, marked "Local".
 */
export const AddWidget: Story = { render: () => <AddWidgetPanel main={noWidgets} initial={{}} /> };

/** A widget state event as Element's room state explorer shows it: more fields than the form uses. */
const PASTED_EVENT = {
  type: "im.vector.modular.widgets",
  state_key: "etherpad_1763294567",
  sender: "@ada:example.org",
  content: { type: "m.etherpad", name: "Etherpad", url: "https://pad.example.org/p/design-crit?userId=$matrix_user_id", data: {} },
  event_id: "$Wq3bH0kTzNcEw7aLrY2mPq",
  origin_server_ts: 1763294567000,
};
/**
 * Add widget: a pasted state event. Pasted from Element's room state explorer: sender, event ID and
 * timestamp are ignored. A type that is not a widget type, or a URL that is not http: or https:, is
 * refused in the form.
 */
export const AddWidgetJson: Story = { render: () => <AddWidgetPanel main={noWidgets} initial={{ form: "json", json: pretty(PASTED_EVENT) }} /> };

const refused: MainViewModel = {
  ...noWidgets,
  widgetWrite: { roomId: ROOMS.design.id, widgetKey: "m.widget/widget-1", state: "failed", error: "M_FORBIDDEN: You don't have permission to post that to the room. user_level (0) < send_level (50)" },
};
/**
 * Add widget: to the room, refused (the session's error). The account may not change the room's
 * widgets. The draft stays, so it can be added only in this host instead. Replacing a widget of the
 * room asks first (confirmation modal).
 */
export const AddWidgetRefused: Story = { render: () => <AddWidgetPanel main={refused} initial={{ target: "room" }} />, parameters: { size: [900, 940] } };
