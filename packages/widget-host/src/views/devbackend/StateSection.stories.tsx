import type { Meta, StoryObj } from "@storybook/react-vite";

import type { DevBackendViewModel } from "../../appViewModel";
import { devMainVm } from "../fixtures";
import { DevBackendView } from "./DevBackendView";

/** The State section inside the whole DevBackendView, as the leaves draw it. Its widget form is the `State` story of DevBackendView. */
const devBackend = (o: Partial<DevBackendViewModel> = {}): DevBackendViewModel => ({ ...devMainVm().devBackend!, openSections: ["state"], ...o });

const meta: Meta<typeof DevBackendView> = {
  title: "SidePanel/DevBackendView/State",
  component: DevBackendView,
  args: { canLeave: true },
  decorators: [
    (Story) => (
      <div className="sidecol" style={{ width: 324, height: 820 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof DevBackendView>;

/** leaf devbackend/state-element-call */
export const ElementCall: Story = { args: { devBackend: devBackend({ stateForm: "elementCall" }) } };

/** leaf devbackend/state-raw */
export const RawJson: Story = { args: { devBackend: devBackend({ stateForm: "raw" }) } };
