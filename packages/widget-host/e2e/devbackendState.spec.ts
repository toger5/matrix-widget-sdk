/** DevBackendView › State: the shortcuts, "send state", the state explorer and "edit state"; widget state events add and remove widget tiles. */
import { expect, LAB, test } from "./host";

type StateEvent = { eventType: string; stateKey: string; content: Record<string, unknown> };
const stateOf = async (host: { store(roomId: string): Promise<{ state: Record<string, unknown>[] }> }, type: string, stateKey = "") =>
  ((await host.store(LAB)).state as StateEvent[]).find((e) => e.eventType === type && e.stateKey === stateKey)?.content;

test.beforeEach(async ({ host }) => {
  await host.populate("lab", { open: [{ room: LAB }] });
  // The drafts and the filter are state of the section, which outlives `populate`: reopening the section resets them.
  const section = host.page.getByTestId("devbackend-view").getByRole("button", { name: /^State \d/ });
  await section.click();
  await section.click();
});

test("shortcuts: edit name, edit description and add member change the room", async ({ host }) => {
  const view = host.page.getByTestId("devbackend-view");

  await view.getByRole("button", { name: "Edit name" }).click();
  await expect(view.getByLabel("Room name")).toHaveValue("Widget lab");
  await view.getByLabel("Room name").fill("Renamed lab");
  await view.getByRole("form", { name: "Edit name" }).getByRole("button", { name: "Save" }).click();
  await expect(view.getByRole("button", { name: /^Renamed lab !lab/ })).toBeVisible();
  await expect(host.panels.locator(".room-name")).toHaveText("Renamed lab");
  expect(await stateOf(host, "m.room.name")).toEqual({ name: "Renamed lab" });

  await view.getByRole("button", { name: "Edit description" }).click();
  await view.getByRole("textbox", { name: "Description" }).fill("A new description");
  await view.getByRole("textbox", { name: "Description" }).press("Enter");
  await expect.poll(() => stateOf(host, "m.room.topic")).toEqual({ topic: "A new description" });

  await view.getByRole("button", { name: "Add member" }).click();
  await view.getByLabel("User ID").fill("dave");
  await view.getByRole("form", { name: "Add member" }).getByRole("button", { name: "Add" }).click();
  await expect(view.getByRole("alert")).toContainText("@user:server");
  await view.getByLabel("User ID").fill("@dave:dev.local");
  await view.getByRole("form", { name: "Add member" }).getByRole("button", { name: "Add" }).click();
  await expect(host.panels.getByTitle("4 members")).toBeVisible();
  expect(await stateOf(host, "m.room.member", "@dave:dev.local")).toEqual({ membership: "join" });
});

test("send state and the state explorer: the sent event is listed by type and key", async ({ host }) => {
  const view = host.page.getByTestId("devbackend-view");
  const form = view.getByRole("form", { name: "Send state" });
  await view.getByRole("button", { name: /^Timeline \d/ }).click();

  await view.getByRole("button", { name: "m.room.member 3" }).click();
  await view.getByRole("button", { name: "State key @bob:dev.local of m.room.member" }).click();
  await expect(view.locator("pre.code")).toContainText('"displayname": "Bob"');
  await host.leaf("devbackend/state");

  await form.getByLabel("Type").fill("org.example.setting");
  await form.getByLabel("State key").fill("colour");
  await form.getByLabel("State content (JSON)").fill("{ broken");
  await form.getByRole("button", { name: "Send" }).click();
  await expect(form.getByRole("alert")).toContainText("Invalid JSON");
  expect(await stateOf(host, "org.example.setting", "colour")).toBeUndefined();

  await form.getByLabel("State content (JSON)").fill('{ "value": "green" }');
  await form.getByRole("button", { name: "Send" }).click();
  await expect(form.getByRole("alert")).toHaveCount(0);
  expect(await stateOf(host, "org.example.setting", "colour")).toEqual({ value: "green" });

  await view.getByRole("button", { name: "org.example.setting 1" }).click();
  await view.getByRole("button", { name: "State key colour of org.example.setting" }).click();
  await expect(view.locator("pre.code")).toContainText("green");

  await view.getByLabel("Filter state by type or key").fill("topic");
  await expect(view.getByRole("button", { name: "org.example.setting 1" })).toHaveCount(0);
  await expect(view.getByRole("button", { name: "State key (empty) of m.room.topic" })).toBeVisible();
});

test("edit state: saving the editor sends a new state event", async ({ host }) => {
  const view = host.page.getByTestId("devbackend-view");
  await view.getByRole("button", { name: /^Timeline \d/ }).click();
  await view.getByRole("button", { name: "m.room.topic 1" }).click();
  await view.getByRole("button", { name: "Edit state event m.room.topic (empty state key)" }).click();
  const editor = view.getByLabel("Content of m.room.topic (empty state key) (JSON)");
  await expect(editor).toHaveValue(/Both test widgets/);
  await view.locator(".editor").getByRole("button", { name: "Save" }).scrollIntoViewIfNeeded();
  await host.leaf("devbackend/state-edit");

  await editor.fill("[1]");
  await view.locator(".editor").getByRole("button", { name: "Save" }).click();
  await expect(view.locator(".editor").getByRole("alert")).toContainText("must be an object");

  await editor.fill('{ "topic": "Edited in place" }');
  await view.locator(".editor").getByRole("button", { name: "Save" }).click();
  await expect(editor).toHaveCount(0);
  await expect(view.locator("pre.code")).toContainText("Edited in place");
  expect(await stateOf(host, "m.room.topic")).toEqual({ topic: "Edited in place" });
});

test("a widget state event with a url adds a widget tile to the open room panel, one without removes it", async ({ host }) => {
  const view = host.page.getByTestId("devbackend-view");
  const form = view.getByRole("form", { name: "Send state" });
  const tile = host.panels.getByRole("button", { name: "Open Whiteboard" });
  await expect(host.panels.getByTestId("widget-tiles").getByRole("button")).toHaveCount(2);

  await form.getByLabel("Type").fill("m.widget");
  await form.getByLabel("State key").fill("whiteboard");
  await form.getByLabel("State content (JSON)").fill('{ "name": "Whiteboard", "url": "http://localhost:5175/new/" }');
  await form.getByRole("button", { name: "Send" }).click();
  await expect(tile).toBeVisible();
  await expect(host.panels.getByTitle("3 widgets")).toBeVisible();

  await form.getByLabel("State content (JSON)").fill("{}");
  await form.getByRole("button", { name: "Send" }).click();
  await expect(tile).toHaveCount(0);
  await expect(host.panels.getByTestId("widget-tiles").getByRole("button")).toHaveCount(2);
});

test("delayed state: the event is scheduled and “Send now” applies it", async ({ host }) => {
  const view = host.page.getByTestId("devbackend-view");
  const form = view.getByRole("form", { name: "Send state" });
  await form.getByLabel("State content (JSON)").fill('{ "topic": "Later" }');
  await form.getByRole("switch", { name: "Send delayed" }).check();
  await form.getByLabel("Delay in milliseconds").fill("60000");
  await form.getByRole("button", { name: "Schedule" }).click();

  const scheduled = view.getByRole("list", { name: "Scheduled events" }).getByRole("listitem");
  await expect(scheduled).toContainText(["m.room.topic"]);
  await expect(scheduled).toContainText(["state · (empty key)"]);
  expect((await host.store(LAB)).delayed).toHaveLength(1);
  expect(await stateOf(host, "m.room.topic")).not.toEqual({ topic: "Later" });

  await scheduled.getByRole("button", { name: "Send now" }).click();
  await expect(scheduled).toHaveCount(0);
  expect(await stateOf(host, "m.room.topic")).toEqual({ topic: "Later" });
});
