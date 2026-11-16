import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { loggableIntent, type AppIntent, type MainViewModel } from "../../appViewModel";
import { ACCOUNTS, mainVm } from "../fixtures";
import { StoryEnv, storySize } from "../storyEnv";
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

/**
 * The column next to the LeftBar: the AccountView, the Settings, the Room list or the Dev tools.
 * When it opens, the RoomsArea is shifted to the side. The stories put it in a sized app shell next
 * to a stand-in for the RoomsArea, where resize and close work; the whole screens are `App/AppShell`
 * stories.
 */
const meta: Meta<typeof SidePanel> = { title: "SidePanel/SidePanel", component: SidePanel, render: (args) => <Shell {...args} /> };
export default meta;
type Story = StoryObj<typeof SidePanel>;

const settings = { devTools: false, devBackend: false, theme: "system" } as const;
const several = [ACCOUNTS.ada, ACCOUNTS.work, ACCOUNTS.bot];

/** The AccountView with several accounts, inside the shell. */
export const AccountOpen: Story = { args: { settings, main: mainVm({ accounts: several, sidePanel: { view: "account", width: 324 } }) }, parameters: { size: [1100, 700] } };

/**
 * The Room list: the room picker in the SidePanel (the recents of `mainVm`; Element Call has a tab).
 * The same content as an empty room panel; the tiles wrap to two columns. The body scrolls.
 */
// leaf sidepanel/rooms
export const RoomList: Story = {
  args: { settings, main: mainVm({ sidePanel: { view: "rooms", width: 324 } }) },
  parameters: { size: [348, 760] },
  // The stage of the side panel stories; the SidePanel is the column itself.
  render: (args, { parameters }) => {
    const [width, height] = storySize(parameters);
    return (
      <div className="stage" style={{ width, height }}>
        <SidePanel {...args} />
      </div>
    );
  },
};

/** Narrow window: the panel overlays the RoomsArea, no resize handle. */
export const NarrowOverlay: Story = {
  args: { settings, main: mainVm({ accounts: several, sidePanel: { view: "account", width: 324 } }) },
  parameters: { size: [700, 700] },
  render: (args) => <Shell {...args} narrow />,
};
