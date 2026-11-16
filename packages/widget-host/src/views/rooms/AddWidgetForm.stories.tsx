import type { Meta, StoryObj } from "@storybook/react-vite";

import { LOCAL_WIDGET, ROOMS } from "../fixtures";
import { AddWidgetForm } from "./AddWidgetForm";

/** The "Add widget" form on its own, in the Widgets card of a RoomOverview. Its states in the overview are the RoomOverview stories `AddWidget*`. */
const meta: Meta<typeof AddWidgetForm> = {
  title: "Rooms/AddWidgetForm",
  component: AddWidgetForm,
  args: { roomId: ROOMS.design.id, roomEvents: ROOMS.design.widgetEvents, localEvents: [LOCAL_WIDGET], userId: "@ada:example.org", onClose: () => console.info("close") },
  parameters: { size: [620, 560] },
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

/** Editing a local widget: the widget form without the chips and "Add to", event type and widget ID fixed, "Save" instead of "Add widget". */
export const Edit: Story = { args: { edit: LOCAL_WIDGET } };

/** "Add to the room": the state event is being sent ("Adding…"). */
export const Sending: Story = {
  args: { initial: { target: "room" }, write: { roomId: ROOMS.design.id, widgetKey: "m.widget/widget-1", state: "sending" } },
};
