import type { Meta, StoryObj } from "@storybook/react-vite";

import { LOCAL_WIDGET, ROOMS } from "../fixtures";
import { AddWidgetForm } from "./AddWidgetForm";

/** The form on its own, in the Widgets card of a RoomOverview. Its leaves are the RoomOverview stories `AddWidget*`. */
const meta: Meta<typeof AddWidgetForm> = {
  title: "Rooms/AddWidgetForm",
  component: AddWidgetForm,
  args: { roomId: ROOMS.design.id, roomEvents: ROOMS.design.widgetEvents, localEvents: [LOCAL_WIDGET], userId: "@ada:example.org", onClose: () => console.info("close") },
  render: (args) => (
    <div className="stage" style={{ width: 620 }}>
      <section className="card span" style={{ width: 580 }}>
        <div className="ov-widgets">
          <AddWidgetForm {...args} />
        </div>
      </section>
    </div>
  ),
};
export default meta;
type Story = StoryObj<typeof AddWidgetForm>;

// No leaf (the doc comment of the mockup's `addWidgetForm`): editing a local widget, without chips and "Add to", type and ID fixed, "Save"
export const Edit: Story = { args: { edit: LOCAL_WIDGET } };

// No leaf: the state event is being sent to the room ("Adding…")
export const Sending: Story = {
  args: { initial: { target: "room" }, write: { roomId: ROOMS.design.id, widgetKey: "m.widget/widget-1", state: "sending" } },
};
