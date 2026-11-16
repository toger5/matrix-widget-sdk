import type { Meta, StoryObj } from "@storybook/react-vite";

import type { MainViewModel } from "../../appViewModel";
import { ROOMS, mainVm, pickerPanel, wk } from "../fixtures";
import { RoomPicker } from "./RoomPicker";
import { SoloPanel } from "./storyFrame";

// The picker is the body of a room panel without a room, so the stories show it inside its panel.
const meta: Meta<typeof RoomPicker> = { title: "Rooms/RoomPicker", component: RoomPicker };
export default meta;
type Story = StoryObj<typeof RoomPicker>;

const story = (main: MainViewModel, mode: "recents" | "allRooms" = "recents"): Story => ({ render: () => <SoloPanel main={main} panel={pickerPanel(mode)} /> });

const now = Date.now();
const recent = (room: keyof typeof ROOMS, widget: Parameters<typeof wk>[0], minutesAgo: number) => ({ roomId: ROOMS[room].id, widgetKey: wk(widget), lastOpened: now - minutesAgo * 60_000 });
const base = mainVm();

// leaf panel/recents
export const Recents = story(
  mainVm({
    data: {
      rooms: base.data.rooms,
      recents: [recent("design", "call", 2), recent("design", "board", 60), recent("platform", "poll", 26 * 60), recent("rtc", "call", 4 * 24 * 60), recent("family", "notes", 13 * 24 * 60), recent("rtc", "board", 19 * 24 * 60)],
    },
  }),
);

// leaf panel/no-recents
export const NoRecents = story(mainVm({ data: { rooms: base.data.rooms, recents: [] } }));

// leaf panel/all-rooms: the search field filters the list and marks the match (the story types "m")
export const AllRooms: Story = {
  ...story(base, "allRooms"),
  play: async ({ canvasElement }) => {
    const input = canvasElement.querySelector<HTMLInputElement>('input[type="search"]');
    if (!input) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "m");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  },
};

// leaf panel/loading
export const Loading = story(mainVm({ data: { rooms: { status: "loading" }, recents: base.data.recents } }));

// leaf panel/error
export const LoadError = story(mainVm({ data: { rooms: { status: "error", error: "The homeserver did not answer (example.org, timeout after 30 s)." }, recents: [] } }));
