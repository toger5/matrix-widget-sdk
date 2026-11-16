/** The Dev tools: which room they show, when they read the state again, what asks first, and the account's send path (the controller on a faked Matrix session whose rooms are a DevBackend's). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { roomStateVersion, roomToolsRoomId, roomToolsRooms, type AppViewModel, type MainViewModel, type ModalViewModel } from "../src/appViewModel";
import { AppController, DEV_ACCOUNT_ID } from "../src/app/controller";
import { changeScheduled, defaultRoomToolsVm, dropScheduled, restartScheduled, roomChangeConfirmation } from "../src/app/roomTools";
import { DevBackend } from "../src/matrix_session/memory/devBackend";
import type { LiveSession, RawEvent, SessionProvider } from "../src/session";
import { mainVm, pickerPanel, ROOMS, roomPanel, workspace } from "../src/views/fixtures";
// The driver's wasm, which the DevBackend's rooms run on.
import "./harness";

const design = ROOMS.design.id;
const platform = ROOMS.platform.id;

describe("Dev tools of a Matrix account: the rooms of the dropdown", () => {
  const twoPanels = (o: Partial<MainViewModel> = {}) =>
    mainVm({ workspaces: { ada: workspace([roomPanel("design", []), pickerPanel(), roomPanel("platform", []), roomPanel("design", [], null, "panel-design-2")]) }, ...o });

  it("lists the rooms of the room panels, left to right, each once", () => {
    expect(roomToolsRooms(twoPanels())).toEqual([design, platform]);
    expect(roomToolsRooms(mainVm({ workspaces: { ada: workspace([pickerPanel()]) } }))).toEqual([]);
  });

  it("shows the picked room while it is open, else the room of the focused panel, else the first open room", () => {
    const focused = (panelId: string, picked?: string) => {
      const m = twoPanels({ roomTools: { ...defaultRoomToolsVm(), selectedRoomIds: picked ? { ada: picked } : {} } });
      return roomToolsRoomId({ ...m, workspaces: { ada: { ...m.workspaces.ada, roomsArea: { ...m.workspaces.ada.roomsArea, focusedPanelId: panelId } } } });
    };
    expect(focused("panel-platform")).toBe(platform);
    expect(focused("panel-design", platform)).toBe(platform);
    // The picked room is no longer open: the focused panel's, or (a picker is focused) the first open room.
    expect(focused("panel-platform", "!closed:example.org")).toBe(platform);
    expect(focused("panel-picker", "!closed:example.org")).toBe(design);
    expect(roomToolsRoomId(mainVm({ workspaces: { ada: workspace([]) } }))).toBeUndefined();
  });
});

describe("Dev tools: when the state is read again", () => {
  const event = (eventId: string, stateKey?: string): RawEvent => ({ type: stateKey === undefined ? "m.room.message" : "m.room.topic", event_id: eventId, content: {}, ...(stateKey === undefined ? {} : { state_key: stateKey }) });
  const ready = (...events: RawEvent[]) => ({ status: "ready" as const, value: { events, atStart: false, loadingOlder: false } });

  it("is the newest state event of the timeline: not yet while it loads, empty when it failed or holds none", () => {
    expect(roomStateVersion({ status: "loading" })).toBeUndefined();
    expect(roomStateVersion({ status: "error", error: "offline" })).toBe("");
    expect(roomStateVersion(ready(event("$1")))).toBe("");
    expect(roomStateVersion(ready(event("$1", ""), event("$2")))).toBe("$1");
  });

  it("changes with a new state event, not with a message or with older events", () => {
    const version = roomStateVersion(ready(event("$1", ""), event("$2")));
    expect(roomStateVersion(ready(event("$1", ""), event("$2"), event("$3")))).toBe(version);
    expect(roomStateVersion(ready(event("$0", ""), event("$1", ""), event("$2")))).toBe(version);
    expect(roomStateVersion(ready(event("$1", ""), event("$2"), event("$4", "")))).not.toBe(version);
  });
});

describe("Dev tools: a state event for a real room asks first when it changes the room's configuration", () => {
  const room = { userId: "@ada:example.org", name: "Design crit", widgetEvents: ROOMS.design.widgetEvents };
  const ask = (type: string, stateKey = "", content: Record<string, unknown> = {}, r: Parameters<typeof roomChangeConfirmation>[1] = room) => roomChangeConfirmation({ type, stateKey, content }, r);

  it("asks for the configuration types, with what they change", () => {
    expect(ask("m.room.power_levels")).toEqual({
      title: "Change the power levels of Design crit?",
      body: "This m.room.power_levels event is sent to the room as @ada:example.org and changes who may do what in it, for everyone. Some changes cannot be undone, for example lowering your own level.",
    });
    for (const type of ["m.room.join_rules", "m.room.encryption", "m.room.history_visibility", "m.room.guest_access", "m.room.server_acl", "m.room.tombstone", "m.room.create", "m.room.canonical_alias"]) {
      expect(ask(type)?.body).toContain(`This ${type} event is sent to the room as @ada:example.org and`);
    }
  });

  it("asks for another user's membership, not for the own one", () => {
    expect(ask("m.room.member", "@bob:example.org")?.title).toBe("Change the membership of @bob:example.org in Design crit?");
    expect(ask("m.room.member", "@ada:example.org")).toBeUndefined();
  });

  it("asks before a widget replaces one of the room, or while the room's widgets are unknown", () => {
    expect(ask("m.widget", "call", { url: "https://example.org" })?.title).toBe("Replace Element Call in Design crit?");
    expect(ask("m.widget", "new-one", { url: "https://example.org" })).toBeUndefined();
    expect(ask("m.widget", "call", {}, { ...room, widgetEvents: undefined })?.title).toBe("Replace a widget in Design crit?");
  });

  it("sends anything else at once", () => {
    expect(ask("m.room.topic")).toBeUndefined();
    expect(ask("m.room.name")).toBeUndefined();
    expect(ask("org.example.custom", "key")).toBeUndefined();
  });
});

describe("Dev tools: what an account scheduled", () => {
  const entry = (delayId: string, scheduledAt = 1) => ({ delayId, type: "m.room.message", delayMs: 5000, restarts: 0, scheduledAt });

  it("is kept per account and room; an empty list is dropped", () => {
    const one = changeScheduled(defaultRoomToolsVm(), "ada", design, (list) => [...list, entry("a"), entry("b")]);
    expect(one.scheduled).toEqual({ ada: { [design]: [entry("a"), entry("b")] } });
    const restarted = changeScheduled(one, "ada", design, (list) => restartScheduled(list, "a", 9));
    expect(restarted.scheduled.ada[design][0]).toEqual({ ...entry("a"), restarts: 1, scheduledAt: 9 });
    // The expiry of the delay before the restart does not drop it; the current one does.
    expect(dropScheduled(restarted.scheduled.ada[design], "a", 1)).toHaveLength(2);
    expect(dropScheduled(restarted.scheduled.ada[design], "a", 9).map((s) => s.delayId)).toEqual(["b"]);
    const empty = changeScheduled(changeScheduled(restarted, "ada", design, (list) => dropScheduled(list, "a")), "ada", design, (list) => dropScheduled(list, "b"));
    expect(empty.scheduled).toEqual({});
  });
});

// ---------------------------------------------------------------------------------------------
// The controller on a Matrix account whose session is a DevBackend in disguise: the account's send
// path ends in the backend of a real (here: mocked) room, as the account.

const REAL = "!real:example.org";

/** A DevBackend posing as the stored login "ada" of a Matrix account. */
function fakeAccount(dev: DevBackend): SessionProvider {
  const session = new Proxy(dev, {
    get: (target, key) => {
      if (key === "accountId") return "ada";
      const value = Reflect.get(target, key, target) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  }) as unknown as LiveSession;
  return {
    startLogin: () => Promise.reject(new Error("not in this test")),
    stored: async () => [{ accountId: "ada", userId: dev.userId }],
    restore: async () => session,
    clearStored: async () => {},
  };
}

describe("Dev tools of a Matrix account: the controller", () => {
  let real: DevBackend;
  let controller: AppController;
  const main = () => (controller.vm.screen as Extract<AppViewModel["screen"], { kind: "main" }>).main;
  const events = async () => (real.refresh(), (await real.timeline(REAL)).events);
  const modal = () => main().modal as Extract<ModalViewModel, { kind: "confirm" }> | undefined;
  const toasts = () => main().toasts.map((t) => t.text);

  beforeEach(async () => {
    vi.stubGlobal("window", globalThis);
    // The DevBackend the controller activates loads its demo media.
    vi.stubGlobal("fetch", async () => new Response("demo"));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    real = new DevBackend({ userId: "@ada:example.org" });
    real.addRoom({ id: REAL, name: "Real room" });
    controller = new AppController({ persist: false, provider: fakeAccount(real) });
    await controller.start(new URLSearchParams());
    controller.dispatch({ type: "settings/set", settings: { devTools: true, devBackend: true } });
    controller.dispatch({ type: "room/open", roomId: REAL });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("the Dev tools button opens them on the room of the focused panel, without switching accounts; they close when dev tools are turned off", () => {
    controller.dispatch({ type: "sidePanel/toggle", view: "roomTools" });
    expect(main().sidePanel.view).toBe("roomTools");
    expect(main().activeAccountId).toBe("ada");
    expect(main().roomTools?.selectedRoomIds).toEqual({ ada: REAL });
    expect(roomToolsRoomId(main())).toBe(REAL);

    controller.dispatch({ type: "settings/set", settings: { devTools: false } });
    expect(main().sidePanel.view).toBeUndefined();
    // Without dev tools (and the DevBackend inactive) the button does nothing.
    controller.dispatch({ type: "sidePanel/toggle", view: "roomTools" });
    expect(main().sidePanel.view).toBeUndefined();
  });

  it("sends events and state as the account through the room's backend; another sender is refused with a toast", async () => {
    controller.dispatch({ type: "roomTools/sendEvent", roomId: REAL, event: { type: "m.room.message", sender: "@ada:example.org", content: { body: "hi" } } });
    await vi.waitFor(async () => expect((await events()).at(-1)).toMatchObject({ type: "m.room.message", sender: "@ada:example.org", content: { body: "hi" } }));

    controller.dispatch({ type: "roomTools/sendEvent", roomId: REAL, event: { type: "m.room.message", sender: "@bob:example.org", content: { body: "as bob" } } });
    expect(toasts()).toEqual(["Sending the event failed: a real room only takes events sent as @ada:example.org"]);

    controller.dispatch({ type: "roomTools/sendState", roomId: REAL, event: { type: "m.room.topic", stateKey: "", content: { topic: "New topic" } } });
    expect(modal()).toBeUndefined();
    await vi.waitFor(async () => expect((real.refresh(), await real.roomDetails(REAL)).topic).toBe("New topic"));
  });

  it("asks before it changes the room's configuration; the confirmed intent sends it", async () => {
    const event = { type: "m.room.power_levels", stateKey: "", content: { users: { "@ada:example.org": 50 } } };
    controller.dispatch({ type: "roomTools/sendState", roomId: REAL, event });
    expect(modal()).toMatchObject({ title: "Change the power levels of Real room?", confirmLabel: "Send the state event", danger: true, intent: { type: "roomTools/sendState", roomId: REAL, event, confirmed: true } });
    expect((await real.roomState(REAL)).some((e) => e.type === "m.room.power_levels")).toBe(false);

    controller.dispatch(modal()!.intent);
    await vi.waitFor(async () => expect((real.refresh(), await real.roomState(REAL)).find((e) => e.type === "m.room.power_levels")?.content).toEqual(event.content));

    // Delayed, too: the confirmed intent keeps the delay.
    controller.dispatch({ type: "modal/close" });
    controller.dispatch({ type: "roomTools/sendState", roomId: REAL, event, delayMs: 5000 });
    expect(modal()?.intent).toEqual({ type: "roomTools/sendState", roomId: REAL, event, delayMs: 5000, confirmed: true });
    expect(main().roomTools?.scheduled.ada).toBeUndefined();
  });

  it("a refusal of the room is a toast", async () => {
    real.store(REAL).failSends("M_FORBIDDEN: you may not");
    controller.dispatch({ type: "roomTools/sendEvent", roomId: REAL, event: { type: "m.room.message", sender: "@ada:example.org", content: { body: "hi" } } });
    await vi.waitFor(() => expect(toasts()).toEqual([expect.stringMatching(/^Sending the event failed: .*you may not/)]));
  });

  it("a delayed event is listed until it is cancelled, sent, or its delay has passed; a restart counts from then", async () => {
    const schedule = (body: string) => controller.dispatch({ type: "roomTools/sendEvent", roomId: REAL, event: { type: "m.room.message", sender: "@ada:example.org", content: { body } }, delayMs: 5000 });
    const scheduled = () => main().roomTools?.scheduled.ada?.[REAL] ?? [];
    schedule("one");
    schedule("two");
    await vi.waitFor(() => expect(scheduled()).toHaveLength(2));
    const [one, two] = scheduled();
    expect(one).toMatchObject({ type: "m.room.message", delayMs: 5000, restarts: 0 });

    controller.dispatch({ type: "roomTools/updateScheduled", roomId: REAL, delayId: one.delayId, update: "cancel" });
    await vi.waitFor(() => expect(scheduled().map((s) => s.delayId)).toEqual([two.delayId]));
    real.refresh();
    expect(real.snapshot(REAL).scheduled.map((s) => s.delayId)).toEqual([two.delayId]);

    vi.advanceTimersByTime(3000);
    controller.dispatch({ type: "roomTools/updateScheduled", roomId: REAL, delayId: two.delayId, update: "restart" });
    await vi.waitFor(() => expect(scheduled()[0].restarts).toBe(1));
    // The first delay would have passed by now; the restarted one has not.
    vi.advanceTimersByTime(3500);
    expect(scheduled()).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(scheduled()).toEqual([]);

    schedule("three");
    await vi.waitFor(() => expect(scheduled()).toHaveLength(1));
    controller.dispatch({ type: "roomTools/updateScheduled", roomId: REAL, delayId: scheduled()[0].delayId, update: "send" });
    await vi.waitFor(() => expect(scheduled()).toEqual([]));
    expect((await events()).at(-1)?.content).toEqual({ body: "three" });
  });

  it("only a delayed event scheduled from here in this room can be sent, restarted or cancelled", async () => {
    // One a widget scheduled: the same account, but not listed.
    const theirs = await real.store(REAL).sendDelayedEvent(REAL, "m.room.message", undefined, { body: "the widget's" }, 5000n);
    controller.dispatch({ type: "roomTools/sendEvent", roomId: REAL, event: { type: "m.room.message", sender: "@ada:example.org", content: { body: "mine" } }, delayMs: 5000 });
    await vi.waitFor(() => expect(main().roomTools?.scheduled.ada?.[REAL]).toHaveLength(1));
    const mine = main().roomTools!.scheduled.ada[REAL][0].delayId;

    controller.dispatch({ type: "roomTools/updateScheduled", roomId: REAL, delayId: theirs, update: "send" });
    controller.dispatch({ type: "roomTools/updateScheduled", roomId: "!other:example.org", delayId: mine, update: "cancel" });
    await vi.waitFor(() => expect(toasts()).toHaveLength(2));
    expect(toasts()[0]).toBe(`Updating the scheduled event failed: ${theirs} was not scheduled from the Dev tools in this room`);
    real.refresh();
    expect(real.snapshot(REAL).scheduled.map((s) => s.delayId).sort()).toEqual([theirs, mine].sort());
  });

  it("logging out forgets the account's picked room and scheduled events; a delay longer than a timer stays listed", async () => {
    vi.stubGlobal("localStorage", { length: 0, key: () => null, removeItem: () => {} });
    controller.dispatch({ type: "sidePanel/toggle", view: "roomTools" });
    const long = 30 * 24 * 3600 * 1000;
    controller.dispatch({ type: "roomTools/sendEvent", roomId: REAL, event: { type: "m.room.message", sender: "@ada:example.org", content: { body: "next month" } }, delayMs: long });
    controller.dispatch({ type: "roomTools/sendEvent", roomId: REAL, event: { type: "m.room.message", sender: "@ada:example.org", content: { body: "soon" } }, delayMs: 5000 });
    await vi.waitFor(() => expect(main().roomTools?.scheduled.ada?.[REAL]).toHaveLength(2));
    // setTimeout would fire a longer delay at once.
    vi.advanceTimersByTime(10);
    expect(main().roomTools?.scheduled.ada?.[REAL]).toHaveLength(2);

    // Logged out from the DevBackend, the app stays on it.
    controller.dispatch({ type: "account/switch", accountId: DEV_ACCOUNT_ID, confirmed: true });
    await vi.waitFor(() => expect(main().activeAccountId).toBe(DEV_ACCOUNT_ID));
    const timers = vi.getTimerCount();
    controller.dispatch({ type: "account/logout", accountId: "ada", confirmed: true });
    await vi.waitFor(() => expect(main().accounts.map((a) => a.id)).toEqual([DEV_ACCOUNT_ID]));
    expect(main().roomTools?.selectedRoomIds.ada).toBeUndefined();
    expect(main().roomTools?.scheduled).toEqual({});
    // The expiry of "soon" is cleared with it.
    expect(vi.getTimerCount()).toBe(timers - 1);
  });

  it("a seed names a known SidePanel view", async () => {
    await expect(controller.populate({ sidePanel: "devBackend" as "roomTools" })).rejects.toThrow('seed.sidePanel: unknown view "devBackend"');
    expect(main().activeAccountId).toBe("ada");
  });

  it("“Switch to the DevBackend” asks while room panels are open, keeps the Dev tools open, and so does leaving it", async () => {
    controller.dispatch({ type: "sidePanel/toggle", view: "roomTools" });
    controller.dispatch({ type: "devBackend/activate" });
    expect(modal()?.intent).toEqual({ type: "account/switch", accountId: DEV_ACCOUNT_ID, confirmed: true });
    controller.dispatch(modal()!.intent);
    await vi.waitFor(() => expect(main().activeAccountId).toBe(DEV_ACCOUNT_ID));
    expect(main().sidePanel.view).toBe("roomTools");
    // The room tools of the DevBackend: what is sent goes to the mocked rooms, not to the account's.
    const mocked = controller.getDevBackend()!;
    controller.dispatch({ type: "mock/addRoom" });
    const room = main().roomTools!.selectedRoomIds[DEV_ACCOUNT_ID];
    controller.dispatch({ type: "roomTools/sendEvent", roomId: room, event: { type: "m.room.message", sender: "@carol:dev.local", content: { body: "mocked" } } });
    await vi.waitFor(async () => expect((await mocked.timeline(room)).events.at(-1)?.sender).toBe("@carol:dev.local"));

    controller.dispatch({ type: "devBackend/leave" });
    await vi.waitFor(() => expect(main().activeAccountId).toBe("ada"));
    expect(main().sidePanel.view).toBe("roomTools");
    expect(roomToolsRoomId(main())).toBe(REAL);

    // Left with dev tools off: the Dev tools are gone with the DevBackend.
    controller.dispatch({ type: "account/switch", accountId: DEV_ACCOUNT_ID, confirmed: true });
    await vi.waitFor(() => expect(main().activeAccountId).toBe(DEV_ACCOUNT_ID));
    controller.dispatch({ type: "settings/set", settings: { devTools: false } });
    expect(main().sidePanel.view).toBe("roomTools");
    controller.dispatch({ type: "devBackend/leave" });
    await vi.waitFor(() => expect(main().activeAccountId).toBe("ada"));
    expect(main().sidePanel.view).toBeUndefined();
  });
});
