/** The RoomOverviewTab: opened by the room header, it shows topic, members and widgets of the room. */
import { expect, LAB, LEGACY_WIDGET, NEW_WIDGET, test, widgetId } from "./host";

const header = "Widget lab · open the room overview";

test("the room header opens the Room overview tab, and switches to it when it is already open", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, settings: { devTools: false }, open: [{ room: LAB, widgets: [NEW_WIDGET] }] });
  await expect(host.page.getByTitle(header)).toContainText("2 widgets");
  await expect(host.page.getByTitle(header)).toContainText("3 members");

  await host.page.getByTitle(header).click();
  await expect(host.page.getByRole("tab")).toHaveText([/New test widget/, /Room overview/]);
  await expect(host.tab("Room overview")).toHaveAttribute("aria-selected", "true");

  const overview = host.page.getByTestId("room-overview");
  await expect(overview.getByRole("heading", { name: "Widget lab", level: 1 })).toBeVisible();
  await expect(overview.getByText(LAB)).toBeVisible();
  await expect(overview.getByText("Both test widgets, a few people and something to read")).toBeVisible();
  await expect(overview.locator(".member b")).toHaveText(["Alice", "Bob", "Carol"]);
  await expect(overview.getByText("@carol:dev.local")).toBeVisible();
  await expect(overview.locator(".ov-widgets button")).toHaveText([/New test widget/, /Legacy test widget/]);
  await expect(overview.getByText("Copy to DevBackend")).toHaveCount(0);
  await host.leaf("overview/plain");

  // Pressing the header again does not open a second overview.
  await host.tab(/New test widget/).click();
  await host.page.getByTitle(header).click();
  await expect(host.page.getByRole("tab")).toHaveCount(2);
  await expect(host.tab("Room overview")).toHaveAttribute("aria-selected", "true");
});

test("pressing a widget in the overview opens it in a new tab", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, open: [{ room: LAB, overview: true }] });
  const overview = host.page.getByTestId("room-overview");

  await overview.getByRole("button", { name: /Legacy test widget/ }).click();
  await expect(host.page.getByRole("tab")).toHaveText([/Room overview/, /Legacy test widget/]);
  await expect(host.tab(/Legacy test widget/)).toHaveAttribute("aria-selected", "true");
  await host.ready(widgetId(LAB, LEGACY_WIDGET));

  // A widget that is already open: its tab is activated, no second one.
  await host.tab("Room overview").click();
  await overview.getByRole("button", { name: /Legacy test widget/ }).click();
  await expect(host.page.getByRole("tab")).toHaveCount(2);
  await expect(host.tab(/Legacy test widget/)).toHaveAttribute("aria-selected", "true");
});

test("with dev tools enabled a DevBackend room still has no “Copy to DevBackend” card", async ({ host }) => {
  await host.populate("lab", { sidePanel: null, open: [{ room: LAB, widgets: [NEW_WIDGET], overview: true }] });
  expect((await host.state()).settings.devTools).toBe(true);
  const overview = host.page.getByTestId("room-overview");
  await expect(overview.locator(".member")).toHaveCount(3);
  await expect(host.button("Dev tools of New test widget")).toHaveCount(1);
  // A DevBackend room is already in the DevBackend, so the dev tools card of the mockup is not reachable here.
  await expect(overview.getByText("Copy to DevBackend")).toHaveCount(0);
  await host.leaf("overview/devtools");
});
