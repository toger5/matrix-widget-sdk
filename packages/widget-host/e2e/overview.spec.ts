/** The RoomOverview: what the room name tab shows and where a room opens; topic, members and widgets of the room. */
import { expect, LAB, LEGACY_WIDGET, NEW_WIDGET, test, widgetId } from "./host";

const header = "Widget lab · open the room overview";

test("a room opens on its overview: the room name is selected; topic, members and widgets", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, settings: { devTools: false }, open: [{ room: LAB }] });
  const roomTab = host.tab("Widget lab");
  await expect(roomTab).toHaveAttribute("aria-selected", "true");
  await expect(roomTab).toHaveAttribute("title", header);
  await expect(roomTab.getByTitle("2 widgets")).toHaveText("2");
  await expect(roomTab.getByTitle("3 members")).toHaveText("3");

  const overview = host.page.getByTestId("room-overview");
  await expect(overview.getByRole("heading", { name: "Widget lab", level: 1 })).toBeVisible();
  await expect(overview.getByText(LAB)).toBeVisible();
  await expect(overview.getByText("Both test widgets, a few people and something to read")).toBeVisible();
  await expect(overview.locator(".member b")).toHaveText(["Alice", "Bob", "Carol"]);
  await expect(overview.getByText("@carol:dev.local")).toBeVisible();
  await expect(overview.locator(".ov-widgets button")).toHaveText([/New test widget/, /Legacy test widget/]);
  await expect(overview.getByText("Copy to DevBackend")).toHaveCount(0);
  await host.leaf("overview/plain");
});

test("pressing a widget in the overview opens it as a new tab at the end; the room name shows the overview again, where it is grayed out", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, open: [{ room: LAB, widgets: [NEW_WIDGET], overview: true }] });
  const overview = host.page.getByTestId("room-overview");
  await expect(host.tab("Widget lab")).toHaveAttribute("aria-selected", "true");

  await overview.getByRole("button", { name: "Open Legacy test widget" }).click();
  await expect(host.page.getByRole("tab")).toHaveText([/Widget lab/, /New test widget/, /Legacy test widget/]);
  await expect(host.tab(/Legacy test widget/)).toHaveAttribute("aria-selected", "true");
  await host.ready(widgetId(LAB, LEGACY_WIDGET));

  // A widget that is already open has no "Open" button: "Jump to tab" brings its tab to the front, no second one.
  await host.page.getByTitle(header).click();
  await expect(host.tab("Widget lab")).toHaveAttribute("aria-selected", "true");
  await expect(overview.getByRole("button", { name: /^Open / })).toHaveCount(0);
  await overview.getByRole("button", { name: "Jump to the tab of Legacy test widget" }).click();
  await expect(host.page.getByRole("tab")).toHaveCount(3);
  await expect(host.tab(/Legacy test widget/)).toHaveAttribute("aria-selected", "true");
});

test("with dev tools enabled a DevBackend room still has no “Copy to DevBackend” card", async ({ host }) => {
  // A seed ends a panel on a widget tab (`active`) or on the room name (`overview`), not both.
  await expect(host.populate("lab", { sidePanel: null, open: [{ room: LAB, widgets: [NEW_WIDGET], overview: true, active: NEW_WIDGET }] })).rejects.toThrow(/both `active` and `overview`/);
  await host.populate("lab", { sidePanel: null, open: [{ room: LAB, widgets: [NEW_WIDGET], overview: true }] });
  expect((await host.state()).settings.devTools).toBe(true);
  const overview = host.page.getByTestId("room-overview");
  await expect(overview.locator(".member")).toHaveCount(3);
  await expect(host.button("Dev tools of New test widget")).toHaveCount(1);
  await expect(overview.getByRole("button", { name: "Jump to the tab of New test widget" })).toBeVisible();
  // A DevBackend room is already in the DevBackend, so the dev tools card of the mockup is not reachable here.
  await expect(overview.getByText("Copy to DevBackend")).toHaveCount(0);
  await host.leaf("overview/devtools");
});
