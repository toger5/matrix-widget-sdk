/**
 * The logins stored in this browser and the clients running for them; SDK free, used by both SDK
 * sessions.
 *
 * Storage: the key `<prefix><accountId>` holds `{ order, record }` (`record`: what the SDK session
 * needs to restore the login; `order`: its position in `list()`). One entry per login, so a token
 * refresh of one never rewrites another, and no index entry that could disagree with them. The
 * single login of the old layout (`legacyKey`) is moved into this one on first read.
 */

export interface StoredAccount<T> {
  accountId: string;
  record: T;
}

interface Entry<T> {
  order: number;
  record: T;
}

export interface AccountStoreOptions<T> {
  /** Prefix of the `localStorage` keys, one per login. */
  prefix: string;
  /** The key the single login was stored under before multi-account. */
  legacyKey: string;
  /** The login found under `legacyKey` (parsed JSON) in the new layout, or `undefined` if it cannot be used. */
  migrate(legacy: unknown): StoredAccount<T> | undefined;
  /** For tests; `localStorage` otherwise. Looked up on every access, so importing this needs no browser. */
  storage?: () => Storage;
}

export class AccountStore<T> {
  constructor(private readonly options: AccountStoreOptions<T>) {}

  private get storage(): Storage {
    return this.options.storage?.() ?? localStorage;
  }

  private key(accountId: string): string {
    return this.options.prefix + accountId;
  }

  private read(key: string): Entry<T> | undefined {
    const raw = this.storage.getItem(key);
    if (!raw) return undefined;
    try {
      const entry = JSON.parse(raw) as Partial<Entry<T>> | null;
      if (entry && typeof entry.order === "number" && entry.record !== undefined) return entry as Entry<T>;
    } catch {
      // Not a login this code wrote.
    }
    return undefined;
  }

  /** The entries as they are stored, without looking at the old layout. */
  private scan(): (StoredAccount<T> & { order: number })[] {
    const storage = this.storage;
    const found: (StoredAccount<T> & { order: number })[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(this.options.prefix)) continue;
      const entry = this.read(key);
      if (entry) found.push({ accountId: key.slice(this.options.prefix.length), record: entry.record, order: entry.order });
    }
    return found.sort((a, b) => a.order - b.order || a.accountId.localeCompare(b.accountId));
  }

  /** The new entry is written before the old key is removed. */
  private migrateLegacy(): void {
    const storage = this.storage;
    const raw = storage.getItem(this.options.legacyKey);
    if (raw === null) return;
    let migrated: StoredAccount<T> | undefined;
    try {
      migrated = this.options.migrate(JSON.parse(raw));
    } catch {
      // Unparsable: "no login", as before.
    }
    if (migrated) this.save(migrated.accountId, migrated.record);
    storage.removeItem(this.options.legacyKey);
  }

  /** The stored logins, in the order they were made. */
  list(): StoredAccount<T>[] {
    this.migrateLegacy();
    return this.scan().map(({ accountId, record }) => ({ accountId, record }));
  }

  get(accountId: string): T | undefined {
    this.migrateLegacy();
    return this.read(this.key(accountId))?.record;
  }

  /** A new login goes to the end of the list, an existing one keeps its place. */
  save(accountId: string, record: T): void {
    const existing = this.read(this.key(accountId));
    const order = existing?.order ?? this.scan().reduce((max, entry) => Math.max(max, entry.order), 0) + 1;
    this.storage.setItem(this.key(accountId), JSON.stringify({ order, record } satisfies Entry<T>));
  }

  /** Does nothing when the login is not stored (any more): a late token refresh must not bring a removed login back. */
  update(accountId: string, change: (record: T) => T): void {
    const existing = this.read(this.key(accountId));
    if (existing) this.storage.setItem(this.key(accountId), JSON.stringify({ order: existing.order, record: change(existing.record) } satisfies Entry<T>));
  }

  remove(accountId: string): void {
    this.storage.removeItem(this.key(accountId));
  }
}

/**
 * The client of each account of this page, or its start in progress. There must never be two for
 * one account: they would share its stores (the js crypto store: both upload one-time keys under
 * the same ids, and encryption breaks for good). React's strict mode calls `restore()` twice.
 */
// TODO-FINDING concurrent-sessions - clients of several accounts run at once; not verified against a homeserver with two clients on one page.
export class RunningClients<T extends { logout(): Promise<void> }> {
  private readonly clients = new Map<string, Promise<T>>();

  /** The account's client, else `start()` becomes it (unless it fails). */
  get(accountId: string, start: () => Promise<T>): Promise<T> {
    return this.clients.get(accountId) ?? this.set(accountId, start());
  }

  set(accountId: string, start: Promise<T>): Promise<T> {
    const tracked: Promise<T> = start.catch((e: unknown) => {
      if (this.clients.get(accountId) === tracked) this.clients.delete(accountId);
      throw e;
    });
    this.clients.set(accountId, tracked);
    return tracked;
  }

  delete(accountId: string): void {
    this.clients.delete(accountId);
  }

  /** Log the account's running client out; false when none runs. A second client must not open its stores. */
  async logout(accountId: string): Promise<boolean> {
    const running = await this.clients.get(accountId)?.catch(() => undefined);
    if (running) await running.logout();
    return running !== undefined;
  }
}
