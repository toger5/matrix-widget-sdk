/**
 * The content of a `DevBackend` as JSON: what an end-to-end test (or the `seed` URL parameter)
 * hands over to start with a known set of mocked rooms instead of clicking them together.
 * `DevBackend.fromSeed` / `populate` read it, `DevBackend.toSeed` writes it. Examples are in
 * `e2e/seeds/`.
 */
import type { StateEvent } from "../../widgetStateEvent";

export interface SeedStateEvent {
  type: string;
  stateKey: string;
  content: Record<string, unknown>;
}

export interface SeedTimelineEvent {
  type: string;
  /** Default: the DevBackend's user. */
  sender?: string;
  content: Record<string, unknown>;
}

export interface SeedMember {
  userId: string;
  displayName?: string;
}

export interface SeedRoom {
  /** Default: a generated local room id. */
  id?: string;
  name: string;
  topic?: string;
  /** Joined members. The DevBackend's user is always a member, listed or not. */
  members?: SeedMember[];
  /** Widget state events (`{ type, state_key, content }`), exactly as a room would hold them. */
  widgets?: StateEvent[];
  /** Any other state. Applied after name, topic, members and widgets, so it can override them. */
  state?: SeedStateEvent[];
  /** Oldest first. */
  timeline?: SeedTimelineEvent[];
  /** Every send of a widget in this room fails. */
  failSends?: boolean;
}

/** One file of the (account-wide) media repository. Exactly one of `base64`, `text` and `url` gives the bytes. */
export interface SeedMedia {
  /** Default: a generated `mxc://` URI. */
  mxcUri?: string;
  name?: string;
  mimetype?: string;
  base64?: string;
  text?: string;
  /** Fetched when the seed is applied; relative URLs are relative to the page. */
  url?: string;
}

export interface DevBackendSeed {
  /** The user the DevBackend acts as. */
  userId?: string;
  rooms?: SeedRoom[];
  media?: SeedMedia[];
  /** Add the demo files of `public/demo/` (what the test widgets download by default). */
  demoMedia?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Validation: a seed is hand-written JSON, so a mistake has to name the place.

const fail = (path: string, problem: string): never => {
  throw new Error(`Invalid DevBackend seed: ${path}: ${problem}`);
};

const describe = (value: unknown) => (value === null ? "null" : Array.isArray(value) ? "an array" : `a ${typeof value}`);

function object(value: unknown, path: string, known: string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail(path, `expected an object, got ${describe(value)}`);
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) fail(`${path}.${key}`, `unknown field (known: ${known.join(", ")})`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  return typeof value === "string" ? value : fail(path, `expected a string, got ${describe(value)}`);
}

function optional<T>(value: unknown, path: string, check: (value: unknown, path: string) => T): T | undefined {
  return value === undefined ? undefined : check(value, path);
}

function boolean(value: unknown, path: string): boolean {
  return typeof value === "boolean" ? value : fail(path, `expected true or false, got ${describe(value)}`);
}

function content(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail(path, `expected an object, got ${describe(value)}`);
  return value as Record<string, unknown>;
}

function list<T>(value: unknown, path: string, item: (value: unknown, path: string) => T): T[] {
  if (!Array.isArray(value)) return fail(path, `expected an array, got ${describe(value)}`);
  return value.map((entry, i) => item(entry, `${path}[${i}]`));
}

function prefixed(value: unknown, path: string, sigil: string, what: string): string {
  const text = string(value, path);
  const ok = sigil === "mxc://" ? /^mxc:\/\/[^/]+\/.+/.test(text) : text.startsWith(sigil) && text.includes(":");
  return ok ? text : fail(path, `expected ${what}, got ${JSON.stringify(text)}`);
}

const userId = (value: unknown, path: string) => prefixed(value, path, "@", "a user id like @alice:dev.local");

/** Drop `undefined` fields, so a validated seed compares equal to the JSON it came from. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function member(value: unknown, path: string): SeedMember {
  const o = object(value, path, ["userId", "displayName"]);
  return compact({ userId: userId(o.userId, `${path}.userId`), displayName: optional(o.displayName, `${path}.displayName`, string) });
}

function widget(value: unknown, path: string): StateEvent {
  const o = object(value, path, ["type", "state_key", "content"]);
  return { type: string(o.type, `${path}.type`), state_key: string(o.state_key, `${path}.state_key`), content: content(o.content, `${path}.content`) };
}

function stateEvent(value: unknown, path: string): SeedStateEvent {
  const o = object(value, path, ["type", "stateKey", "content"]);
  return { type: string(o.type, `${path}.type`), stateKey: string(o.stateKey, `${path}.stateKey`), content: content(o.content, `${path}.content`) };
}

function timelineEvent(value: unknown, path: string): SeedTimelineEvent {
  const o = object(value, path, ["type", "sender", "content"]);
  return compact({ type: string(o.type, `${path}.type`), sender: optional(o.sender, `${path}.sender`, userId), content: content(o.content, `${path}.content`) });
}

function room(value: unknown, path: string): SeedRoom {
  const o = object(value, path, ["id", "name", "topic", "members", "widgets", "state", "timeline", "failSends"]);
  return compact({
    id: optional(o.id, `${path}.id`, (v, p) => prefixed(v, p, "!", "a room id like !lab:dev.local")),
    name: string(o.name, `${path}.name`),
    topic: optional(o.topic, `${path}.topic`, string),
    members: optional(o.members, `${path}.members`, (v, p) => list(v, p, member)),
    widgets: optional(o.widgets, `${path}.widgets`, (v, p) => list(v, p, widget)),
    state: optional(o.state, `${path}.state`, (v, p) => list(v, p, stateEvent)),
    timeline: optional(o.timeline, `${path}.timeline`, (v, p) => list(v, p, timelineEvent)),
    failSends: optional(o.failSends, `${path}.failSends`, boolean),
  });
}

function media(value: unknown, path: string): SeedMedia {
  const o = object(value, path, ["mxcUri", "name", "mimetype", "base64", "text", "url"]);
  const sources = ["base64", "text", "url"].filter((key) => o[key] !== undefined);
  if (sources.length !== 1) fail(path, `expected exactly one of base64, text and url, got ${sources.length === 0 ? "none" : sources.join(" and ")}`);
  const base64 = optional(o.base64, `${path}.base64`, string);
  if (base64 !== undefined) {
    try {
      atob(base64);
    } catch {
      fail(`${path}.base64`, "not valid base64");
    }
  }
  return compact({
    mxcUri: optional(o.mxcUri, `${path}.mxcUri`, (v, p) => prefixed(v, p, "mxc://", "a content URI like mxc://dev.local/file")),
    name: optional(o.name, `${path}.name`, string),
    mimetype: optional(o.mimetype, `${path}.mimetype`, string),
    base64,
    text: optional(o.text, `${path}.text`, string),
    url: optional(o.url, `${path}.url`, string),
  });
}

/**
 * Check parsed JSON against `DevBackendSeed`. Throws an `Error` that names the field
 * (`seed.rooms[1].members[0].userId: expected ...`); unknown fields are errors too, so a typo
 * does not silently seed nothing.
 */
export function validateSeed(json: unknown): DevBackendSeed {
  const o = object(json, "seed", ["userId", "rooms", "media", "demoMedia"]);
  const seed = compact({
    userId: optional(o.userId, "seed.userId", userId),
    rooms: optional(o.rooms, "seed.rooms", (v, p) => list(v, p, room)),
    media: optional(o.media, "seed.media", (v, p) => list(v, p, media)),
    demoMedia: optional(o.demoMedia, "seed.demoMedia", boolean),
  });
  const ids = new Set<string>();
  seed.rooms?.forEach(({ id }, i) => {
    if (id === undefined) return;
    if (ids.has(id)) fail(`seed.rooms[${i}].id`, `${id} is used by an earlier room`);
    ids.add(id);
  });
  return seed;
}

// ---------------------------------------------------------------------------------------------
// Bytes <-> JSON

export function bytesToBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = "";
  // In chunks: `String.fromCharCode(...bytes)` overflows the stack for a large file.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function base64ToBytes(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
