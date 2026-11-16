// Screenshots of stories (the visual specification) and of the app.
//   node e2e/tools/shot.mjs story <story id, e.g. app-leftbar--expanded> <out.png> [width] [height] [light]
//   node e2e/tools/shot.mjs url   <url> <out.png> [width] [height]
//   node e2e/tools/shot.mjs all   <out dir> [light]
// Stories need Storybook (`npm run storybook`, port 6006). A story is rendered at its own size (`parameters.size`,
// which the preview writes to `<html data-story-size>`; 1280x800 by default) unless a width and height are given,
// and shot once Storybook reports it rendered (the `storyRendered` event of the preview: after the `play` function),
// or after 5 s. The theme is dark, with `light` light (a story with a fixed theme keeps it). The script prints page
// and console errors; a story that does not exist, throws or whose `play` function throws is reported at once and
// makes the exit code 1 (the screenshot is still written).
//
// `all` is the regression check of a change that should not change any pixel (a CSS refactor): it writes every
// story (`<dir>/<theme>/stories/<id>.png`) with `.styles.txt`, a hash of the computed style of every element, which
// also shows changes that draw nothing (cursor, pointer-events). Animations are off (reduced motion). Run it before
// and after the change into two directories and compare them with `diff -rq <before> <after>`.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { chromium } from "@playwright/test";

const STORYBOOK = "http://localhost:6006";
const RENDER_TIMEOUT_MS = 5000;

const [kind, id, out, ...rest] = process.argv.slice(2);
if (kind === "all") {
  if (!id) throw new Error("usage: shot.mjs all <out dir> [light]");
  await all(id, out === "light" || rest.includes("light"));
  process.exit(); // with process.exitCode: 1 if a story failed
}
if (!["story", "url"].includes(kind) || !id || !out) throw new Error("usage: shot.mjs story|url <id> <out.png> [width] [height] [light] | all <out dir> [light]");
const light = rest.includes("light");
const [w, h] = rest.filter((a) => a !== "light").map(Number);

let size = { width: w || 1280, height: h || 800 };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: size });
await page.addInitScript(listenForRender);
page.on("pageerror", (e) => console.error("page error:", e.message));
page.on("console", (m) => m.type() === "error" && console.error("console error:", m.text()));
if (kind === "story") {
  const own = await openStory(page, storyUrl(id, light), { resize: !(w && h) });
  if (!(w && h) && own) size = own;
  await settle(page);
} else {
  await page.goto(id, { waitUntil: "load" });
  await page.waitForTimeout(400);
}
await page.screenshot({ path: out });
await browser.close();
console.log(`${out} ${size.width}x${size.height}`);

function storyUrl(storyId, lightTheme) {
  return `${STORYBOOK}/iframe.html?id=${storyId}&viewMode=story&globals=theme:${lightTheme ? "light" : "dark"}`;
}

/**
 * Before any script of the page: catch the preview's channel as Storybook creates it and note the `storyRendered`
 * event (emitted once the story rendered and its `play` function ended) in `window.__shotRendered`, and the events
 * that end a story without it (no such story, an exception in the story or its `play` function) in
 * `window.__shotFailed`.
 */
function listenForRender() {
  let channel;
  Object.defineProperty(globalThis, "__STORYBOOK_ADDONS_CHANNEL__", {
    configurable: true,
    get: () => channel,
    set(value) {
      channel = value;
      value?.on?.("storyRendered", (storyId) => (globalThis.__shotRendered = storyId));
      for (const event of ["storyMissing", "storyErrored", "storyThrewException", "playFunctionThrewException"]) {
        value?.on?.(event, (detail) => (globalThis.__shotFailed ??= `${event}${detail?.message || detail?.title ? `: ${detail.message ?? detail.title}` : ""}`));
      }
    },
  });
}

/**
 * Opens a story and waits until it rendered (the page needs `listenForRender` as init script); returns its size (`<html data-story-size>`, written by the preview). If
 * the viewport has another size, the story is opened again at its own size, so it lays out (and measures) at that
 * size from the start.
 */
async function openStory(page, url, { resize = true } = {}) {
  /** Loads the story; returns what went wrong, if anything. */
  const load = async () => {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => globalThis.__shotRendered || globalThis.__shotFailed, null, { timeout: RENDER_TIMEOUT_MS }).catch(() => {});
    const failed = await page.evaluate(() => globalThis.__shotFailed ?? (globalThis.__shotRendered ? undefined : "no storyRendered"));
    if (failed === "no storyRendered") return `no storyRendered within ${RENDER_TIMEOUT_MS / 1000} s`;
    if (failed) return failed;
    if (!(await page.$("#storybook-root > *"))) return "the story rendered nothing";
  };
  let problem = await load();
  const attr = await page.evaluate(() => document.documentElement.dataset.storySize);
  const [width, height] = (attr ?? "").split("x").map(Number);
  const viewport = page.viewportSize();
  const own = width && height ? { width, height } : undefined;
  if (own && resize && (viewport?.width !== width || viewport?.height !== height)) {
    await page.setViewportSize(own);
    problem = await load();
  }
  if (problem) {
    console.error(`${url}: ${problem}`);
    process.exitCode = 1;
  }
  return own;
}

/** After the render: the fonts, and two frames for what the play function's last changes lay out. */
async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

/** One line per element (and per drawn ::before / ::after): its path and a hash of its computed style. */
function styleFingerprint() {
  const lines = [];
  const hash = (s) => {
    let x = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
    return (x >>> 0).toString(16);
  };
  const styleOf = (el, pseudo) => {
    const cs = getComputedStyle(el, pseudo);
    const props = [];
    for (let i = 0; i < cs.length; i++) props.push(`${cs[i]}:${cs.getPropertyValue(cs[i])}`);
    return props.sort().join(";"); // custom properties come in no fixed order
  };
  const walk = (el, path) => {
    lines.push(`${path} ${hash(styleOf(el))}`);
    for (const pseudo of ["::before", "::after"]) {
      const content = getComputedStyle(el, pseudo).content;
      if (content !== "none" && content !== "normal") lines.push(`${path}${pseudo} ${hash(styleOf(el, pseudo))}`);
    }
    [...el.children].forEach((child, i) => {
      const cls = typeof child.className === "string" && child.className.trim() ? `.${child.className.trim().split(/\s+/).join(".")}` : "";
      walk(child, `${path}>${i}:${child.tagName.toLowerCase()}${cls}`);
    });
  };
  walk(document.documentElement, "html");
  return lines.join("\n") + "\n";
}

async function all(dir, lightTheme) {
  let stories;
  try {
    const index = await (await fetch(`${STORYBOOK}/index.json`)).json();
    stories = Object.values(index.entries).filter((e) => e.type === "story").map((e) => e.id);
  } catch {
    throw new Error(`Storybook does not run on ${STORYBOOK}: npm run storybook -w @matrix-widget-tools/widget-host`);
  }
  dir = join(dir, lightTheme ? "light" : "dark"); // both themes can go into the same directory
  const browser = await chromium.launch();
  const page = await browser.newPage({ reducedMotion: "reduce" });
  await page.addInitScript(listenForRender);
  page.on("pageerror", (e) => console.error("page error:", e.message));
  for (const story of stories) {
    const file = join(dir, "stories", story);
    await openStory(page, storyUrl(story, lightTheme));
    await settle(page);
    mkdirSync(dirname(file), { recursive: true });
    await page.screenshot({ path: `${file}.png`, animations: "disabled" });
    writeFileSync(`${file}.styles.txt`, await page.evaluate(styleFingerprint));
  }
  await browser.close();
  console.log(`${dir}: ${stories.length} stories (${lightTheme ? "light" : "dark"})`);
}
