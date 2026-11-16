/**
 * The logins stored in this browser, one `localStorage` entry per login, so several can be stored
 * side by side and a token refresh of one never rewrites another.
 *
 * Layout: the key `<prefix><accountId>` holds `{ order, record }`. `record` is whatever the SDK
 * session needs to restore the login, `order` the position in `list()` (the order the logins
 * were made in). There is no index entry that could disagree with the entries.
 *
 * Before multi-account there was one login under one key (`legacyKey`). It is moved into the
 * new layout the first time the store is read, so the user stays logged in on the same device.
 *
 * Knows no SDK: both SDK sessions use it (the matrix-rust-sdk one imports it from here).
 */
// TODO-FINDING account-store-location - this file is SDK independent and used by both providers; it lives under js/ only because the task allowed no file outside js/ and rust/. Move it to src/matrix_session/ or src/lib/.

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

  /** Move the login of the old single-key layout into the new one. The new entry is written before the old key is removed. */
  private migrateLegacy(): void {
    const storage = this.storage;
    const raw = storage.getItem(this.options.legacyKey);
    if (raw === null) return;
    let migrated: StoredAccount<T> | undefined;
    try {
      migrated = this.options.migrate(JSON.parse(raw));
    } catch {
      // The old code treated an entry it could not parse as "no login" too.
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

  /** Store a login. A new one goes to the end of the list, an existing one keeps its place. */
  save(accountId: string, record: T): void {
    const existing = this.read(this.key(accountId));
    const order = existing?.order ?? this.scan().reduce((max, entry) => Math.max(max, entry.order), 0) + 1;
    this.storage.setItem(this.key(accountId), JSON.stringify({ order, record } satisfies Entry<T>));
  }

  /** Change a stored login. Does nothing when it is not stored (any more): a late token refresh must not bring a removed login back. */
  update(accountId: string, change: (record: T) => T): void {
    const existing = this.read(this.key(accountId));
    if (existing) this.storage.setItem(this.key(accountId), JSON.stringify({ order: existing.order, record: change(existing.record) } satisfies Entry<T>));
  }

  remove(accountId: string): void {
    this.storage.removeItem(this.key(accountId));
  }
}
