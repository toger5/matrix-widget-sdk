/** The room dev tools tab of a room panel (“Open room dev tools” of the room overview): the bar of the widget dev tools on top, the State and Timeline panels, toggles, dock, resize, one tab per panel. stories `rooms-roomdevtools--*`, `rooms-tabbar--room-dev-tools-active`, `rooms-roomoverview--room-dev-tools-open` */
import type { Locator } from "@playwright/test";

import type { TabViewModel } from "../src/appViewModel";
import { expect, type Host, LAB, NEW_WIDGET, test } from "./host";

const tools = (host: Host, panel: Locator = host.panels.first()) => panel.getByTestId("room-dev-tools");
const bar = (host: Host, panel?: Locator) => tools(host, panel).getByRole("toolbar", { name: "Room dev tools" });
const toggle = (host: Host, name: "State" | "Timeline", panel?: Locator) => bar(host, panel).getByRole("button", { name: new RegExp(`^${name}(,|$)`) });
const region = (host: Host, name: "State" | "Timeline", panel?: Locator) => tools(host, panel).getByRole("region", { name, exact: true });
/** The room dev tools tabs of the DevBackend's workspace, per panel. */
const toolsTabs = async (host: Host) =>
  (await host.main()).workspaces.devBackend.roomsArea.panels.map((p) => (p.content.kind === "room" ? p.content.tabs.filter((t): t is Extract<TabViewModel, { kind: "roomTools" }> => t.kind === "roomTools") : []));

/** The lab room on its overview with dev tools enabled; “Open room dev tools” pressed. */
async function openTab(host: Host) {
  await host.populate("lab", { sidePanel: null, settings: { devTools: true }, behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET], overview: true }] });
  await host.page.getByTestId("room-overview").getByRole("button", { name: "Open room dev tools" }).click();
}

test("“Open room dev tools” adds the tab at the end: bar on top, State and Timeline side by side; “Show room dev tools” shows it again", async ({ host }) => {
  await openTab(host);
  await expect(host.page.getByRole("tab")).toHaveText([/Widget lab/, /New test widget/, /Room dev tools/]);
  const tab = host.tab("Room dev tools");
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(tab).toHaveAttribute("title", "Room dev tools of Widget lab");
  // A host tab: a close button, no dev tools button of its own.
  await expect(host.button("Close the room dev tools")).toHaveAttribute("title", "Close the room dev tools (Alt+W)");
  await expect(host.button(/^Dev tools of/)).toHaveCount(1);

  await expect(tools(host)).toHaveClass(/dt-top/);
  await expect(bar(host)).toHaveAttribute("aria-orientation", "horizontal");
  await expect(bar(host).getByRole("radio", { name: "Dock to the top" })).toHaveAttribute("aria-checked", "true");
  await expect(bar(host).getByRole("img", { name: "Room data is ready" })).toBeVisible();
  await expect(toggle(host, "State")).toHaveAccessibleName(/^State, \d+$/);
  await expect(toggle(host, "Timeline")).toHaveAccessibleName(/^Timeline, \d+$/);
  await expect(toggle(host, "State")).toHaveAttribute("aria-pressed", "true");
  await expect(toggle(host, "Timeline")).toHaveAttribute("aria-pressed", "true");
  // The labelled toggles fit the bar.
  await expect(bar(host)).not.toHaveClass(/dt-compact/);
  await expect(toggle(host, "State").getByText("State", { exact: true })).toBeVisible();
  // No reload and no close on the bar; never the DevBackend's tools.
  await expect(bar(host).getByRole("button", { name: /Close|Reload/ })).toHaveCount(0);
  await expect(tools(host).getByRole("button", { name: /Backend Tool/ })).toHaveCount(0);
  const [state, timeline] = [(await region(host, "State").boundingBox())!, (await region(host, "Timeline").boundingBox())!];
  expect(timeline.y).toBe(state.y);
  expect(timeline.x).toBeGreaterThan(state.x + state.width - 1);
  expect((await toolsTabs(host))[0]).toEqual([expect.objectContaining({ layout: { dock: "top", panels: [{ panel: "state", share: 1 }, { panel: "timeline", share: 1 }] } })]);
  await host.story("rooms-tabbar--room-dev-tools-active");
  await host.story("rooms-roomdevtools--docked-top");

  // The overview offers the tab it has instead of a second one.
  await host.tab("Widget lab").click();
  const show = host.page.getByTestId("room-overview").getByRole("button", { name: "Show room dev tools" });
  await expect(show).toBeVisible();
  await expect(host.page.getByTestId("room-overview").getByRole("button", { name: "Open timeline" })).toBeVisible();
  await host.story("rooms-roomoverview--room-dev-tools-open");
  await show.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(host.page.getByRole("tab")).toHaveCount(3);

  // A narrow room panel: the panels stay side by side; the labelled toggles do not fit, so the bar shows icons and counts.
  await host.page.setViewportSize({ width: 440, height: 640 });
  await expect(bar(host)).toHaveClass(/dt-compact/);
  await expect(toggle(host, "State").getByText("State", { exact: true })).toBeHidden();
  await expect(toggle(host, "State")).toHaveAccessibleName(/^State, \d+$/);
  await host.story("rooms-roomdevtools--narrow");
  // Wide again: the labels come back.
  await host.page.setViewportSize({ width: 1280, height: 800 });
  await expect(bar(host)).not.toHaveClass(/dt-compact/);

  // Closed, it goes like any tab: the neighbour is shown.
  await host.button("Close the room dev tools").click();
  await expect(host.tab("Room dev tools")).toHaveCount(0);
  await expect(host.tab(/New test widget/)).toHaveAttribute("aria-selected", "true");
});

test("the toggles and the × of a panel open and close the panels; the filters; docked left the panels stack; the separator resizes them", async ({ host }) => {
  await openTab(host);
  // State closed: Timeline takes the whole width.
  await toggle(host, "State").click();
  await expect(toggle(host, "State")).toHaveAttribute("aria-pressed", "false");
  await expect(region(host, "State")).toHaveCount(0);
  await expect(region(host, "Timeline")).toBeVisible();
  await host.page.getByTestId("room-dev-tools").getByRole("button", { name: "Send event", exact: true }).click();
  await host.story("rooms-roomdevtools--one-panel");
  // Opened again it comes back in bar order; the × of a panel closes it like its toggle.
  await toggle(host, "State").click();
  await expect(tools(host).getByRole("region", { name: /^(State|Timeline)$/ })).toHaveCount(2);
  await expect(tools(host).locator(".dt-panel").first()).toHaveAttribute("data-dev-panel", "state");
  await region(host, "Timeline").getByRole("button", { name: "Close Timeline" }).click();
  await expect(toggle(host, "Timeline")).toHaveAttribute("aria-pressed", "false");
  await toggle(host, "Timeline").click();
  expect((await toolsTabs(host))[0][0].layout.panels.map((p) => p.panel)).toEqual(["state", "timeline"]);

  // The filters: what matches, and that nothing does.
  await region(host, "State").getByLabel("Filter state by type or key").fill("m.space");
  await region(host, "Timeline").getByLabel("Filter events by type or sender").fill("@zoe");
  await expect(region(host, "State")).toContainText("No state event matches the filter.");
  await expect(region(host, "Timeline")).toContainText("No event matches the filter.");
  await expect(region(host, "State")).toContainText(/0 of \d+/);
  await host.story("rooms-roomdevtools--no-match");
  await region(host, "Timeline").getByLabel("Filter events by type or sender").fill("@bob");
  const bobs = (await host.store(LAB)).timeline.filter((e) => e.sender === "@bob:dev.local").length;
  expect(bobs).toBeGreaterThan(0);
  await expect(region(host, "Timeline").getByRole("list", { name: "Timeline events" }).getByRole("listitem")).toHaveCount(bobs);
  await region(host, "State").getByLabel("Filter state by type or key").fill("");
  await region(host, "Timeline").getByLabel("Filter events by type or sender").fill("");

  // Docked left: a vertical strip at the edge, the panels stack, each as wide as the tab.
  await bar(host).getByRole("radio", { name: "Dock to the left" }).click();
  await expect(tools(host)).toHaveClass(/dt-left/);
  await expect(bar(host)).toHaveAttribute("aria-orientation", "vertical");
  const [state, timeline] = [(await region(host, "State").boundingBox())!, (await region(host, "Timeline").boundingBox())!];
  expect(timeline.x).toBe(state.x);
  expect(timeline.y).toBeGreaterThan(state.y + state.height - 1);
  expect((await toolsTabs(host))[0][0].layout.dock).toBe("left");
  // The SidePanel's room dev tools keep their own layout.
  expect((await host.main()).roomTools?.layout.dock).toBe("left");
  await bar(host).getByRole("radio", { name: "Dock to the right" }).click();
  expect((await host.main()).roomTools?.layout.dock).toBe("left");
  await bar(host).getByRole("radio", { name: "Dock to the left" }).click();
  await region(host, "State").getByRole("button", { name: "Send state", exact: true }).click();
  await region(host, "State").getByRole("button", { name: /^m\.room\.member/ }).click();
  await region(host, "State").getByRole("button", { name: "State key @bob:dev.local of m.room.member" }).click();
  await host.story("rooms-roomdevtools--docked-left");

  // The separator between the panels: by keyboard, Enter resets it.
  const separator = tools(host).getByRole("separator", { name: "Resize the dev tool panels State and Timeline" });
  await expect(separator).toHaveAttribute("aria-valuenow", "50");
  await separator.press("ArrowDown");
  await expect(separator).toHaveAttribute("aria-valuenow", "55");
  const shares = (await toolsTabs(host))[0][0].layout.panels.map((p) => p.share);
  expect(shares[0] / (shares[0] + shares[1])).toBeCloseTo(0.55);
  await separator.press("Enter");
  await expect(separator).toHaveAttribute("aria-valuenow", "50");
});

test("a room dev tools tab dragged onto a panel of its room that has one: that one is shown, one is left", async ({ host }) => {
  await openTab(host);
  // A second panel of the room, with its own room dev tools tab.
  await host.page.keyboard.press("Alt+Shift+KeyN");
  await expect(host.panels).toHaveCount(2);
  const [first, second] = [host.panels.nth(0), host.panels.nth(1)];
  await second.getByTestId("room-overview").getByRole("button", { name: "Open room dev tools" }).click();
  await expect(tools(host, second)).toBeVisible();
  expect((await toolsTabs(host)).map((tabs) => tabs.length)).toEqual([1, 1]);
  const secondId = (await second.getAttribute("data-panel-id"))!;
  const kept = (await toolsTabs(host))[1][0].id;

  await host.drag(first.getByRole("tab", { name: /Room dev tools/ }), await host.at(second, 0.5, 0.5), { target: `into:${secondId}` });
  await expect(first.getByRole("tab", { name: /Room dev tools/ })).toHaveCount(0);
  await expect(second.getByRole("tab", { name: /Room dev tools/ })).toHaveCount(1);
  await expect(second.getByRole("tab", { name: /Room dev tools/ })).toHaveAttribute("aria-selected", "true");
  expect((await toolsTabs(host)).map((tabs) => tabs.map((t) => t.id))).toEqual([[], [kept]]);
});
