import type { Meta, StoryObj } from "@storybook/react-vite";

import type { MainViewModel, SettingsViewModel } from "../../appViewModel";
import { LOCAL_WIDGET, ROOMS, mainVm, roomPanel, timelineTab, widgetTab, widgetVm, workspace } from "../fixtures";
import { IconButton } from "../ui/atoms";
import { pretty } from "../ui/forms";
import type { AddWidgetDraft } from "./AddWidgetForm";
import { RoomOverview } from "./RoomOverview";
import { AppFrame, DEV_SETTINGS, SETTINGS, SoloPanel } from "./storyFrame";
import { TabBar } from "./TabBar";

// The overview is what the room name tab shows, so the stories show it inside its room panel.
const meta: Meta<typeof RoomOverview> = { title: "Rooms/RoomOverview", component: RoomOverview };
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

// leaf overview/plain: no widget open, dev tools disabled
const empty = roomPanel("design", []);
export const Plain: Story = { render: () => <SoloPanel main={mainVm({ workspaces: { ada: workspace([empty]) }, widgets: {} })} panel={empty} settings={SETTINGS} /> };

// leaf overview/devtools: the call has a tab in this panel ("jump to tab"), so has the timeline ("Show timeline"); a local widget; "Add widget" and the DevBackend card with "Copy to DevBackend"
const withCall = roomPanel("design", [widgetTab("design", "call"), timelineTab("design")], null);
const call = widgetVm("design", "call");
const withLocal = (o: Partial<MainViewModel>) => {
  const main = mainVm(o);
  return { ...main, data: { ...main.data, localWidgets: { [ROOMS.design.id]: [LOCAL_WIDGET] } } };
};
export const DevTools: Story = {
  render: () => <SoloPanel main={withLocal({ workspaces: { ada: workspace([withCall]) }, widgets: { [call.id]: call } })} panel={withCall} settings={DEV_SETTINGS} />,
};

const noWidgets = mainVm({ workspaces: { ada: workspace([empty]) }, widgets: {} });

// leaf overview/add-widget: the widget form, only in this host (prefilled with the test widget and the first free ID)
export const AddWidget: Story = { render: () => <AddWidgetPanel main={noWidgets} initial={{}} /> };

/** A widget state event as Element's room state explorer shows it (`PASTED_EVENT` of the mockups). */
const PASTED_EVENT = {
  type: "im.vector.modular.widgets",
  state_key: "etherpad_1763294567",
  sender: "@ada:example.org",
  content: { type: "m.etherpad", name: "Etherpad", url: "https://pad.example.org/p/design-crit?userId=$matrix_user_id", data: {} },
  event_id: "$Wq3bH0kTzNcEw7aLrY2mPq",
  origin_server_ts: 1763294567000,
};
// leaf overview/add-widget-json: a pasted state event
export const AddWidgetJson: Story = { render: () => <AddWidgetPanel main={noWidgets} initial={{ form: "json", json: pretty(PASTED_EVENT) }} /> };

// leaf overview/add-widget-refused: to the room, refused (the session's error); the draft stays
const refused: MainViewModel = {
  ...noWidgets,
  widgetWrite: { roomId: ROOMS.design.id, widgetKey: "m.widget/widget-1", state: "failed", error: "M_FORBIDDEN: You don't have permission to post that to the room. user_level (0) < send_level (50)" },
};
export const AddWidgetRefused: Story = { render: () => <AddWidgetPanel main={refused} initial={{ target: "room" }} /> };
