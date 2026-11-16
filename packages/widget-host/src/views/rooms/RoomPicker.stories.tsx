import type { Meta, StoryObj } from "@storybook/react-vite";

import type { MainViewModel } from "../../appViewModel";
import type { RoomSummary } from "../../session";
import { ROOMS, WIDGET_EVENTS, mainVm, pickerPanel, roomPanel, widgetTab, workspace } from "../fixtures";
import { RoomPicker } from "./RoomPicker";
import { SoloPanel } from "./storyFrame";

/**
 * The room picker, no title: recent widgets, recent rooms (tiles; a group without entries is left
 * out), then all rooms with the search field. It is the body of a room panel without a room (so the
 * stories show it inside its panel) and of the Room list in the SidePanel. The body scrolls.
 */
const meta: Meta<typeof RoomPicker> = { title: "Rooms/RoomPicker", component: RoomPicker, parameters: { size: [760, 520] } };
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

/** Recent widgets (one open in a tab), recent rooms, all rooms. Element Call has a tab in another room panel: it is marked "open", and pressing it jumps to that tab. */
// leaf panel/recents
export const Recents = story(ready());

/** No recents yet: all rooms only. */
// leaf panel/no-recents
export const NoRecents = story(ready({ recentWidgets: [], recentRooms: [] }));

/**
 * Searching: scrolled to the search field, the matches below. The field (query "pla") scrolled to
 * the top when it got the focus; the recent groups are above it, out of view. The first match
 * (highlighted) is what Enter opens; Escape clears the search.
 */
// leaf panel/search
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

/** No rooms: no search field. */
// leaf panel/no-rooms
export const NoRooms = story(ready({ rooms: { status: "ready", value: [] }, recentWidgets: [], recentRooms: [] }));

/** Loading (every list has a loading state). */
// leaf panel/loading
export const Loading = story(ready({ rooms: { status: "loading" } }));

/** Error (every list has an error state): the reason and "Try again". */
// leaf panel/error
export const LoadError = story(ready({ rooms: { status: "error", error: "The homeserver did not answer (example.org, timeout after 30 s)." }, recentWidgets: [], recentRooms: [] }));
