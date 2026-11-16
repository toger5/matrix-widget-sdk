import type { Meta, StoryObj } from "@storybook/react-vite";
import { within } from "storybook/test";

import { ACCOUNTS } from "../fixtures";
import { LeftBar } from "./LeftBar";

/** The slim bar on the left, on a `.stage` of the story's size: the bar sits directly on the app background. */
const meta: Meta<typeof LeftBar> = {
  title: "App/LeftBar",
  component: LeftBar,
  args: { leftBar: { collapsed: false, expandButtonVisible: false }, devTools: false, devBackendActive: false, account: ACCOUNTS.ada },
  render: (args, { parameters }) => {
    const [width, height] = parameters.size as [number, number];
    return (
      <div className={`stage ${args.devBackendActive ? "fence" : ""}`} style={{ width, height }}>
        <LeftBar {...args} />
      </div>
    );
  },
  parameters: { size: [68, 620] },
};
export default meta;
type Story = StoryObj<typeof LeftBar>;

/** Expanded, dev tools disabled. */
export const Expanded: Story = {};

/** Dev tools enabled: the Dev tools button. Whether the DevBackend is enabled makes no difference here: it is activated from the AccountView or the bottom of the Dev tools. */
export const DevToolsEnabled: Story = { args: { devTools: true } };

/** DevBackend active: the Dev tools button highlighted (shown even with dev tools disabled). The account icon is the DevBackend icon. */
export const DevBackendActive: Story = { args: { devTools: true, devBackendActive: true, sidePanelView: "roomTools", account: ACCOUNTS.dev } };

/**
 * DevBackend active, the Dev tools button hovered (here: focused, which shows the same tooltip): it
 * opens and closes the Dev tools, never switches accounts.
 */
export const DevBackendHover: Story = {
  args: DevBackendActive.args,
  parameters: { size: [230, 620] },
  play: ({ canvasElement }) => within(canvasElement).getByRole("button", { name: "Dev tools" }).focus(),
};
