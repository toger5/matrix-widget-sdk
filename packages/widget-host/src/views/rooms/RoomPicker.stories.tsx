import type { Meta, StoryObj } from "@storybook/react-vite";

import type { MainViewModel } from "../../appViewModel";
import type { RoomSummary } from "../../session";
import { ROOMS, WIDGET_EVENTS, mainVm, pickerPanel, roomPanel, widgetTab, workspace } from "../fixtures";
import { RoomPicker } from "./RoomPicker";
import { SoloPanel } from "./storyFrame";

// The picker is the body of a room panel without a room, so the stories show it inside its panel.
const meta: Meta<typeof RoomPicker> = { title: "Rooms/RoomPicker", component: RoomPicker };
export default meta;
type Story = StoryObj<typeof RoomPicker>;

const story = (main: MainViewModel): Story => ({ render: () => <SoloPanel main={main} panel={pickerPanel()} /> });

/** The rooms of the mockup's list (`PICKER_ROOMS`): the fixture rooms plus some only the list shows. */
const extra = (id: string, name: string, memberCount: number, widgets: (keyof typeof WIDGET_EVENTS)[]): RoomSummary => ({ id: `!${id}:example.org`, name, memberCount, widgetEvents: widgets.map((w) => WIDGET_EVENTS[w]) });
const LIST: RoomSummary[] = [
  extra("bOoKcLuBxY", "Book club", 9, []),
  ROOMS.design,
  ROOMS.family,
  extra("hOlIdAyPl", "Holiday planning", 5, ["timer"]),
  extra("iNfRaOnCa", "Infra on-call", 14, ["timer", "stream"]),
  ROOMS.rtc,
  ROOMS.platform,
  extra("pLaYwRiGh", "Playwright flakes", 6, ["retro"]),
  extra("rElEaSeTr", "Release train", 27, ["retro", "stream"]),
];

// The recents of `mainVm` (Element Call, Whiteboard, Standup poll, Meeting notes; Design crit, Platform team, MatrixRTC, Family). Element Call has a tab in another panel.
const ready = (o: Partial<MainViewModel["data"]> = {}) =>
  mainVm({
    workspaces: { ada: workspace([roomPanel("design", [widgetTab("design", "call")]), pickerPanel()]) },
    data: { ...mainVm().data, rooms: { status: "ready", value: LIST }, ...o },
  });

// leaf panel/recents
export const Recents = story(ready());

// leaf panel/no-recents
export const NoRecents = story(ready({ recentWidgets: [], recentRooms: [] }));

// leaf panel/search: the search field has the focus and the query "pla", so it scrolled to the top
export const Search: Story = {
  ...story(ready()),
  play: async ({ canvasElement }) => {
    const input = canvasElement.querySelector<HTMLInputElement>('input[type="search"]');
    if (!input) return;
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "pla");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  },
};

// leaf panel/loading
export const Loading = story(ready({ rooms: { status: "loading" } }));

// leaf panel/error
export const LoadError = story(ready({ rooms: { status: "error", error: "The homeserver did not answer (example.org, timeout after 30 s)." }, recentWidgets: [], recentRooms: [] }));
