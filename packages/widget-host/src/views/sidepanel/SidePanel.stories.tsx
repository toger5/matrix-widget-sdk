import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { loggableIntent, type AppIntent, type MainViewModel } from "../../appViewModel";
import { ACCOUNTS, mainVm } from "../fixtures";
import { StoryEnv } from "../storyEnv";
import { SidePanel, type SidePanelProps } from "./SidePanel";

/** The panel inside a sized app shell, next to a stand-in for the RoomsArea. Resize and close work. */
function Shell({ main: initial, settings, narrow = false }: SidePanelProps & { narrow?: boolean }) {
  const [main, setMain] = useState<MainViewModel>(initial);
  const dispatch = (intent: AppIntent) => {
    console.info("intent", loggableIntent(intent));
    if (intent.type === "sidePanel/resize") setMain((m) => ({ ...m, sidePanel: { ...m.sidePanel, width: intent.width } }));
    if (intent.type === "sidePanel/close") setMain((m) => ({ ...m, sidePanel: { ...m.sidePanel, view: undefined } }));
  };
  return (
    <StoryEnv env={{ dispatch, narrow }}>
      <div className={`app ${narrow ? "narrow" : ""}`} style={{ width: narrow ? 700 : 1100, height: 700 }}>
        <div style={{ width: 44, flex: "none" }} />
        <SidePanel main={main} settings={settings} />
        <main className="roomsarea">
          <div className="area-empty">
            <b>RoomsArea</b>
            <p>Shifted by the open SidePanel.</p>
          </div>
        </main>
      </div>
    </StoryEnv>
  );
}

const meta: Meta<typeof SidePanel> = { title: "SidePanel/SidePanel", component: SidePanel, render: (args) => <Shell {...args} /> };
export default meta;
type Story = StoryObj<typeof SidePanel>;

const settings = { devTools: false, theme: "system" } as const;
const several = [ACCOUNTS.ada, ACCOUNTS.work, ACCOUNTS.bot];

// leaf sidepanel/account-several inside the shell (as in app/account)
export const AccountOpen: Story = { args: { settings, main: mainVm({ accounts: several, sidePanel: { view: "account", width: 324 } }) } };

// leaf roomsarea/shifted (the settings, wider than the default)
export const SettingsWide: Story = { args: { settings, main: mainVm({ sidePanel: { view: "settings", width: 420 } }) } };

// leaf sidepanel/closed: nothing is rendered
export const Closed: Story = { args: { settings, main: mainVm() } };

// leaf sidepanel/rooms: the Room list (the recents of `mainVm`; Element Call has a tab)
export const RoomList: Story = { args: { settings, main: mainVm({ sidePanel: { view: "rooms", width: 324 } }) } };

// narrow window: the panel overlays, no resize handle
export const NarrowOverlay: Story = {
  args: { settings, main: mainVm({ accounts: several, sidePanel: { view: "account", width: 324 } }) },
  render: (args) => <Shell {...args} narrow />,
};
