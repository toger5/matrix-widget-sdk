/** DevBackendView: the mocked rooms (dropdown, add, clear, remove) and the tools: the Client Backend Tool (widget host behavior, to-device messages) and the Media Backend Tool. */
import { expect, LAB, NEW_WIDGET, test, widgetId } from "./host";

const NEW = widgetId(LAB, NEW_WIDGET);
const STANDUP = "!standup:dev.local";

test("no rooms yet: the RoomsArea is empty, a new room panel has no room to offer; “Create a room” adds and selects the first room", async ({ host }) => {
  await host.populate("empty");
  const view = host.page.getByTestId("devbackend-view");
  await expect(view.getByText("No mocked rooms yet")).toBeVisible();
  await expect(host.panels).toHaveCount(0);
  await expect(host.page.getByText("No room panel open")).toBeVisible();
  await host.leaf("devbackend/none");
  await host.leaf("app/devbackend-empty");

  await host.leftBar.getByRole("button", { name: /New room panel/ }).click();
  const picker = host.panels.getByTestId("room-picker");
  await expect(picker.getByText("This account has not joined a room yet.")).toBeVisible();
  await expect(picker.getByRole("searchbox")).toHaveCount(0);
  await host.leaf("panel/no-rooms");

  await view.getByRole("button", { name: "Create a room" }).click();
  await expect(view).toHaveAttribute("data-room-id", /^!room1:/);
  await expect(view.getByRole("button", { name: /^State \d/ })).toBeVisible();
  const rooms = (await host.main()).data.rooms;
  expect(rooms.status === "ready" && rooms.value.map((r) => r.id)).toEqual([await view.getAttribute("data-room-id")]);
  // the picker lists it
  await expect(picker.locator("button.row")).toHaveAttribute("data-room-id", (await view.getAttribute("data-room-id"))!);
});

test("room dropdown: select a room, add a room and open it in a new room panel", async ({ host }) => {
  await host.populate("two-rooms");
  const view = host.page.getByTestId("devbackend-view");
  await view.getByRole("button", { name: /^Widget lab !lab/ }).click();
  const rooms = host.page.getByRole("listbox", { name: "Mocked rooms" });
  await expect(rooms.getByRole("option")).toHaveText([/Widget lab/, /Standup/]);
  await expect(rooms.getByRole("option", { name: /Widget lab/ })).toHaveAttribute("aria-selected", "true");
  await host.leaf("devbackend/dropdown");

  await rooms.getByRole("option", { name: /Standup/ }).click();
  await expect(view).toHaveAttribute("data-room-id", STANDUP);
  expect((await host.main()).devBackend?.selectedRoomId).toBe(STANDUP);

  await view.getByRole("button", { name: /^Standup !standup/ }).click();
  await host.button("Add room").click();
  await expect(view).not.toHaveAttribute("data-room-id", STANDUP);
  const added = (await view.getAttribute("data-room-id"))!;
  expect(await host.store(added)).toMatchObject({ timeline: expect.any(Array) });

  // the new room is selectable in the dropdown and in the room list of a new room panel
  await view.getByRole("button", { name: new RegExp(added) }).click();
  await expect(rooms.getByRole("option")).toHaveCount(3);
  await host.page.keyboard.press("Escape");
  await host.leftBar.getByRole("button", { name: /New room panel/ }).click();
  await host.panels.locator(`button.row[data-room-id="${added}"]`).click();
  await expect(host.panels).toHaveAttribute("data-room-id", added);
});

test("remove room: its room panel closes and the next room is selected", async ({ host }) => {
  await host.populate("two-rooms", { open: [{ room: LAB }, { room: STANDUP }] });
  const view = host.page.getByTestId("devbackend-view");
  await expect(host.panels).toHaveCount(2);
  await view.getByRole("button", { name: "Room actions" }).click();
  await host.page.getByRole("menuitem", { name: /Remove room/ }).click();

  await expect(view).toHaveAttribute("data-room-id", STANDUP);
  await expect(host.panels).toHaveCount(1);
  await expect(host.panels).toHaveAttribute("data-room-id", STANDUP);
  expect(await host.store(LAB)).toBeUndefined();
});

test("clear room: the events and the widgets are gone, the room stays", async ({ host }) => {
  await host.populate("lab", { open: [{ room: LAB }] });
  const view = host.page.getByTestId("devbackend-view");
  await expect(host.panels.getByRole("button", { name: "Open New test widget" })).toBeVisible();
  await view.getByRole("button", { name: "Room actions" }).click();
  await host.page.getByRole("menuitem", { name: /Clear room/ }).click();

  await expect(view.getByRole("list", { name: "Timeline events" })).not.toContainText("m.room.message");
  await expect(host.panels.getByRole("button", { name: "Open New test widget" })).toHaveCount(0);
  await expect(view.getByRole("button", { name: /^Widget lab !lab/ })).toBeVisible();
  const store = await host.store(LAB);
  // the room keeps its skeleton: create event, name and the user's membership
  expect(store.timeline.map((e) => e.eventType)).toEqual(["m.room.create", "m.room.name", "m.room.member"]);
  expect(store.state.some((e) => e.eventType === "m.widget")).toBe(false);
});

test("widget host behavior: the same for every room; without auto-approve the widget asks for permissions", async ({ host }) => {
  await host.populate("two-rooms", { behavior: { autoApproveCapabilities: true }, open: [{ room: LAB }] });
  const view = host.page.getByTestId("devbackend-view");
  const side = host.page.getByTestId("sidepanel");
  await view.getByRole("button", { name: /^State \d/ }).click();
  await view.getByRole("button", { name: /^Timeline \d/ }).click();
  await side.getByRole("button", { name: "Client Backend Tool" }).click();
  // "Widget host behavior" is open when the tool opens.
  const client = host.page.getByTestId("devbackend-client");
  const autoApprove = client.getByRole("switch", { name: "Auto-approve capabilities" });
  await expect(autoApprove).toBeChecked();
  await expect(side.getByRole("separator", { name: "Resize the client backend box" })).toBeVisible();
  await host.leaf("devbackend/behavior");

  // The tool belongs to the account: another room shows the same behavior.
  await view.getByRole("button", { name: /^Widget lab !lab/ }).click();
  await host.page.getByRole("listbox", { name: "Mocked rooms" }).getByRole("option", { name: /Standup/ }).click();
  await expect(view).toHaveAttribute("data-room-id", STANDUP);
  await expect(autoApprove).toBeChecked();

  await autoApprove.click();
  await expect(autoApprove).not.toBeChecked();
  expect((await host.main()).devBackend?.behavior.autoApproveCapabilities).toBe(false);
  await host.button("Open New test widget").click();
  await expect(host.page.getByTestId("capability-prompt")).toBeVisible();
  expect((await host.main()).widgets[NEW].prompts.capabilities).toBeDefined();

  // By keyboard: the control that replaces the pressed one takes the focus.
  const minimise = client.getByRole("button", { name: "Minimise the client backend tool" });
  await minimise.press("Enter");
  await expect(client).toHaveCount(0);
  const button = side.getByRole("button", { name: "Client Backend Tool" });
  await expect(button).toBeFocused();
  await button.press("Enter");
  await expect(minimise).toBeFocused();
});

test("widget host behavior: “fail sends” answers the widget's send with an error", async ({ host }) => {
  await host.populate("lab", { behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET] }] });
  await host.ready(NEW);
  await host.page.getByTestId("sidepanel").getByRole("button", { name: "Client Backend Tool" }).click();
  const view = host.page.getByTestId("devbackend-client");
  await view.getByRole("switch", { name: "Fail sends" }).click();
  await expect(view.getByRole("switch", { name: "Fail sends" })).toBeChecked();

  const before = (await host.store(LAB)).timeline.length;
  await host.frame(NEW).getByRole("button", { name: "send m.room.message" }).click();
  await expect(host.frame(NEW).locator("#log pre.error").first()).toContainText("send m.room.message failed");
  expect((await host.store(LAB)).timeline).toHaveLength(before);

  await view.getByRole("switch", { name: "Fail sends" }).click();
  await host.frame(NEW).getByRole("button", { name: "send m.room.message" }).click();
  await expect.poll(async () => (await host.store(LAB)).timeline.length).toBe(before + 1);
});

test("to-device: a message sent from the view reaches the widget, one sent by the widget is listed", async ({ host }) => {
  await host.populate("lab", { behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET] }] });
  await host.ready(NEW);
  const room = host.page.getByTestId("devbackend-view");
  await room.getByRole("button", { name: /^State \d/ }).click();
  await room.getByRole("button", { name: /^Timeline \d/ }).click();
  await host.page.getByTestId("sidepanel").getByRole("button", { name: "Client Backend Tool" }).click();
  const view = host.page.getByTestId("devbackend-client");
  await view.getByRole("button", { name: "Widget host behavior" }).click();
  await view.getByRole("button", { name: /^To-device messages/ }).click();
  // Higher, as in the leaf: by keyboard (End is the largest share).
  const separator = host.page.getByRole("separator", { name: "Resize the client backend box" });
  await separator.press("End");
  await expect(separator).toHaveAttribute("aria-valuenow", "80");
  await separator.press("ArrowDown");
  await expect(separator).toHaveAttribute("aria-valuenow", "75");
  expect((await host.main()).devBackend?.tools.heightShare).toBe(0.75);
  const form = view.getByRole("form", { name: "Send to-device message" });
  const messages = view.getByRole("list", { name: "To-device messages" }).getByRole("listitem");

  await form.getByLabel("Type").fill("org.example.ping");
  await form.getByLabel("Device ID").fill("BOBDEVICE");
  await form.getByLabel("To-device content (JSON)").fill('{ "hello": "from the host" }');
  await form.getByRole("button", { name: "Send" }).click();
  await expect(messages).toHaveCount(1);
  await expect(messages.first()).toContainText("to widget");
  await expect.poll(() => host.actions(NEW, "toWidget")).toContainEqual(expect.stringMatching(/forward_to_device$/));
  await expect(host.frame(NEW).locator("#log")).toContainText("from the host");

  await host.frame(NEW).getByRole("button", { name: "send to-device org.example.ping" }).click();
  await expect(messages).toHaveCount(2);
  await expect(messages.filter({ hasText: "from widget" })).toContainText("@bob:example.org");
  expect((await host.store(LAB)).toDeviceSent).toHaveLength(1);
  await host.leaf("devbackend/todevice");

  await form.getByLabel("To-device content (JSON)").fill("{ nope");
  await form.getByRole("button", { name: "Send" }).click();
  await expect(form.getByRole("alert")).toContainText("Invalid JSON");
  await expect(messages).toHaveCount(2);
});

test("media tool: open (closing the client tool), upload a file, copy its MXC URI, minimise", async ({ host }) => {
  await host.populate("lab");
  const side = host.page.getByTestId("sidepanel");
  const view = host.page.getByTestId("devbackend-view");
  await view.getByRole("button", { name: /^State \d/ }).click();
  await view.getByRole("button", { name: /^Timeline \d/ }).click();
  await expect(side.getByRole("button", { name: "Client Backend Tool" })).toBeVisible();
  await expect(side.getByRole("button", { name: /Media Backend Tool/ })).toContainText("3 files");
  await host.leaf("devbackend/tools-collapsed");

  // Only one tool box is open at a time.
  await side.getByRole("button", { name: "Client Backend Tool" }).click();
  await expect(host.page.getByTestId("devbackend-client")).toBeVisible();
  await side.getByRole("button", { name: /Media Backend Tool/ }).click();
  await expect(host.page.getByTestId("devbackend-client")).toHaveCount(0);
  await expect(side.getByRole("button", { name: "Client Backend Tool" })).toBeVisible();
  const box = host.page.getByTestId("devbackend-media");
  const files = box.getByRole("list", { name: "Media files" }).getByRole("listitem");
  await expect(box.getByRole("button", { name: /Drop files or browse/ })).toBeVisible();
  const separator = side.getByRole("separator", { name: "Resize the media box" });
  await expect(separator).toHaveAttribute("aria-valuenow", "50");
  await expect(files).toHaveText([/landscape\.png/, /tiles\.png/, /notes\.txt/]);
  expect((await host.main()).devBackend?.tools.open).toBe("media");
  await expect.poll(() => files.first().locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await host.leaf("devbackend/media-open");

  // Dragging the handle up makes the box larger; a double click resets it.
  const at = (await separator.boundingBox())!;
  await host.page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await host.page.mouse.down();
  await host.page.mouse.move(at.x + at.width / 2, at.y + at.height / 2 - 100, { steps: 5 });
  await host.page.mouse.up();
  await expect.poll(async () => Number(await separator.getAttribute("aria-valuenow"))).toBeGreaterThan(55);
  await separator.dblclick();
  await expect(separator).toHaveAttribute("aria-valuenow", "50");

  await box.getByLabel("Upload media files").setInputFiles({ name: "upload.txt", mimeType: "text/plain", buffer: Buffer.from("hello media") });
  await expect(files).toHaveCount(4);
  const uploaded = files.filter({ hasText: "upload.txt" });
  await expect(uploaded).toContainText("text/plain · 11 B · uploaded here");

  await uploaded.getByRole("button", { name: "Copy the MXC URI of upload.txt" }).click();
  await expect(host.page.getByTestId("toast")).toContainText("MXC URI copied");
  const mxc = await host.page.evaluate(() => navigator.clipboard.readText());
  expect(mxc).toMatch(/^mxc:\/\//);
  await expect(uploaded).toContainText(mxc);

  await box.getByRole("button", { name: "Minimise the media tool" }).click();
  await expect(box).toHaveCount(0);
  await expect(side.getByRole("button", { name: /Media Backend Tool/ })).toContainText("4 files");
});

test("media tool: a file the widget uploads is listed with the widget as uploader", async ({ host }) => {
  await host.populate("lab", { behavior: { autoApproveCapabilities: true }, open: [{ room: LAB, widgets: [NEW_WIDGET] }] });
  await host.ready(NEW);
  await host.page.getByTestId("sidepanel").getByRole("button", { name: /Media Backend Tool/ }).click();
  const files = host.page.getByTestId("devbackend-media").getByRole("list", { name: "Media files" }).getByRole("listitem");
  const seeded = await files.count();

  await host.frame(NEW).locator("#chooser").setInputFiles({ name: "from-widget.png", mimeType: "image/png", buffer: Buffer.from("not really a png") });
  await host.frame(NEW).getByRole("button", { name: "upload_file: chosen file" }).click();
  await expect(files).toHaveCount(seeded + 1);
  await expect(files.filter({ hasText: "image/png · 16 B" })).toContainText("by m.widget/widget-1");
  expect(await host.actions(NEW, "fromWidget")).toContainEqual(expect.stringMatching(/upload_file$/));
});
