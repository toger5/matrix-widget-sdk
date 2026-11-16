/**
 * Where the logins are stored (`src/matrix_session/js/accountStore`) and what the two SDK
 * providers do with it: several logins side by side, the login of the old single-key layout
 * taken over, and one account cleared without touching the others. `localStorage`, `indexedDB`
 * and `fetch` are faked; no SDK client is started.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountStore } from "../src/matrix_session/js/accountStore";
import * as js from "../src/matrix_session/js/session";
import * as rust from "../src/matrix_session/rust/session";

/** `localStorage`, in memory. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(initial));
  return {
    get length() {
      return items.size;
    },
    key: (index: number) => [...items.keys()][index] ?? null,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
    clear: () => items.clear(),
  };
}

const keys = (storage: Storage) => Array.from({ length: storage.length }, (_, i) => storage.key(i)!).sort();

describe("AccountStore", () => {
  type Login = { user: string; token: string };
  const setup = (initial: Record<string, string> = {}) => {
    const storage = fakeStorage(initial);
    const migrate = vi.fn((legacy: unknown) => ({ accountId: "old", record: legacy as Login }));
    const store = new AccountStore<Login>({ prefix: "logins:", legacyKey: "login_v1", migrate, storage: () => storage });
    return { storage, store, migrate };
  };

  it("keeps several logins side by side, in the order they were made", () => {
    const { store, storage } = setup();
    store.save("b", { user: "@b:hs", token: "1" });
    store.save("a", { user: "@a:hs", token: "2" });
    store.save("c", { user: "@c:hs", token: "3" });
    // Saving an existing login again (a token refresh) keeps its place.
    store.save("b", { user: "@b:hs", token: "4" });

    expect(store.list().map((login) => login.accountId)).toEqual(["b", "a", "c"]);
    expect(store.get("b")).toEqual({ user: "@b:hs", token: "4" });
    expect(keys(storage)).toEqual(["logins:a", "logins:b", "logins:c"]);
  });

  it("removes one login and leaves the others, and what else is in the storage, alone", () => {
    const { store, storage } = setup({ unrelated: "x" });
    store.save("a", { user: "@a:hs", token: "1" });
    store.save("b", { user: "@b:hs", token: "2" });
    store.remove("a");

    expect(store.list()).toEqual([{ accountId: "b", record: { user: "@b:hs", token: "2" } }]);
    expect(store.get("a")).toBeUndefined();
    expect(keys(storage)).toEqual(["logins:b", "unrelated"]);
  });

  it("does not bring a removed login back with an update", () => {
    const { store } = setup();
    store.save("a", { user: "@a:hs", token: "1" });
    store.update("a", (login) => ({ ...login, token: "2" }));
    expect(store.get("a")?.token).toBe("2");
    store.remove("a");
    store.update("a", (login) => ({ ...login, token: "3" }));
    expect(store.list()).toEqual([]);
  });

  it("takes the login of the old layout over, once", () => {
    const { store, storage, migrate } = setup({ login_v1: JSON.stringify({ user: "@old:hs", token: "t" }) });

    expect(store.list()).toEqual([{ accountId: "old", record: { user: "@old:hs", token: "t" } }]);
    expect(keys(storage)).toEqual(["logins:old"]);
    store.save("new", { user: "@new:hs", token: "n" });
    expect(store.list().map((login) => login.accountId)).toEqual(["old", "new"]);
    expect(migrate).toHaveBeenCalledTimes(1);
  });

  it("drops an old login it cannot read, and ignores entries that are not logins", () => {
    const { store, storage } = setup({ login_v1: "{not json", "logins:broken": "{}" });
    expect(store.list()).toEqual([]);
    expect(storage.getItem("login_v1")).toBeNull();
  });
});

describe("the SDK providers' stored logins", () => {
  let storage: Storage;
  let deleted: string[];
  let requests: string[];

  beforeEach(() => {
    deleted = [];
    requests = [];
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("indexedDB", {
      deleteDatabase(name: string) {
        deleted.push(name);
        const request: { onsuccess?: () => void } = {};
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    });
    // The homeserver cannot be reached: logging out there fails, the stored login goes all the same.
    vi.stubGlobal("fetch", async (input: URL | string) => {
      requests.push(String(input));
      throw new TypeError("offline");
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const use = (initial: Record<string, string>) => vi.stubGlobal("localStorage", (storage = fakeStorage(initial)));

  const jsLogin = (user: string, cryptoDatabasePrefix?: string) => ({
    homeserverUrl: "https://hs.example.org",
    userId: user,
    deviceId: `DEV${user}`,
    accessToken: `token-${user}`,
    ...(cryptoDatabasePrefix ? { cryptoDatabasePrefix } : {}),
  });

  it("js: the login of the old layout becomes the first account and keeps its tokens, device and crypto store", async () => {
    const old = jsLogin("@old:example.org");
    use({ [js.LEGACY_STORAGE_KEY]: JSON.stringify(old) });

    expect(await js.jsSdkSessions.stored()).toEqual([{ accountId: js.LEGACY_ACCOUNT_ID, userId: "@old:example.org", homeserver: "https://hs.example.org" }]);
    expect(keys(storage)).toEqual([js.STORAGE_PREFIX + js.LEGACY_ACCOUNT_ID]);
    // Unchanged, and without a crypto store name: it keeps the SDK's default store.
    expect(JSON.parse(storage.getItem(js.STORAGE_PREFIX + js.LEGACY_ACCOUNT_ID)!).record).toEqual(old);
    expect(requests).toEqual([]);
  });

  it("js: clearing one account deletes its entry and its crypto store only", async () => {
    use({
      [js.LEGACY_STORAGE_KEY]: JSON.stringify(jsLogin("@old:example.org")),
      [`${js.STORAGE_PREFIX}second`]: JSON.stringify({ order: 5, record: jsLogin("@second:example.org", "widget-host-js-second") }),
      [`${js.STORAGE_PREFIX}third`]: JSON.stringify({ order: 6, record: jsLogin("@third:example.org", "widget-host-js-third") }),
    });
    // The migrated login is not put in front of logins made since: it goes to the end.
    expect((await js.jsSdkSessions.stored()).map((login) => login.accountId)).toEqual(["second", "third", js.LEGACY_ACCOUNT_ID]);

    await js.jsSdkSessions.clearStored("second");

    expect((await js.jsSdkSessions.stored()).map((login) => login.userId)).toEqual(["@third:example.org", "@old:example.org"]);
    expect(deleted.filter((name) => name.includes("matrix-sdk-crypto")).sort()).toEqual(["widget-host-js-second::matrix-sdk-crypto", "widget-host-js-second::matrix-sdk-crypto-meta"]);
    expect(deleted.some((name) => name.startsWith("matrix-js-sdk::") || name.includes("third"))).toBe(false);
    // It tried to log out on the homeserver, with the cleared account's token.
    expect(requests.some((url) => url.includes("/logout"))).toBe(true);

    // The migrated account's crypto store is the SDK's default one.
    await js.jsSdkSessions.clearStored(js.LEGACY_ACCOUNT_ID);
    expect(deleted).toContain("matrix-js-sdk::matrix-sdk-crypto");
    expect((await js.jsSdkSessions.stored()).map((login) => login.accountId)).toEqual(["third"]);
  });

  it("js: restoring or clearing an account that is not stored", async () => {
    use({});
    await expect(js.jsSdkSessions.restore("nobody")).rejects.toThrow(/No login is stored/);
    await js.jsSdkSessions.clearStored("nobody");
    expect(requests).toEqual([]);
    expect(deleted).toEqual([]);
  });

  const rustLogin = (user: string, storeId: string) => ({
    session: { accessToken: `token-${user}`, userId: user, deviceId: "DEV", homeserverUrl: "https://hs.example.org/", slidingSyncVersion: 1 },
    passphrase: "secret",
    storeId,
  });

  it("rust: the login of the old layout becomes an account with its store id, and its stores keep their names", async () => {
    const old = rustLogin("@old:example.org", "store-old");
    use({ [rust.LEGACY_STORAGE_KEY]: JSON.stringify(old) });

    expect(await rust.rustSdkSessions.stored()).toEqual([{ accountId: "store-old", userId: "@old:example.org", homeserver: "https://hs.example.org/" }]);
    expect(keys(storage)).toEqual([`${rust.STORAGE_PREFIX}store-old`]);
    expect(JSON.parse(storage.getItem(`${rust.STORAGE_PREFIX}store-old`)!).record).toEqual(old);
    expect(deleted).toEqual([]);
  });

  it("rust: clearing one account deletes its entry and its IndexedDB stores only", async () => {
    use({
      [rust.LEGACY_STORAGE_KEY]: JSON.stringify(rustLogin("@old:example.org", "store-old")),
      [`${rust.STORAGE_PREFIX}store-b`]: JSON.stringify({ order: 1, record: rustLogin("@b:example.org", "store-b") }),
      // A login of the js provider is none of the rust provider's.
      [`${js.STORAGE_PREFIX}other`]: JSON.stringify({ order: 1, record: jsLogin("@js:example.org", "widget-host-js-other") }),
    });
    expect((await rust.rustSdkSessions.stored()).map((login) => login.accountId)).toEqual(["store-b", "store-old"]);

    await rust.rustSdkSessions.clearStored("store-b");

    expect(await rust.rustSdkSessions.stored()).toEqual([{ accountId: "store-old", userId: "@old:example.org", homeserver: "https://hs.example.org/" }]);
    expect(deleted.length).toBeGreaterThan(0);
    expect(deleted.every((name) => name === "widget-host-store-store-b" || name.startsWith("widget-host-store-store-b::"))).toBe(true);
    expect(keys(storage)).toEqual([`${rust.STORAGE_PREFIX}store-old`, `${js.STORAGE_PREFIX}other`].sort());
  });
});
