// Screenshots for comparing a view with its mockup.
//   node e2e/tools/shot.mjs leaf  <leaf id, e.g. leftbar/expanded>  <out.png> [light]
//   node e2e/tools/shot.mjs story <story id, e.g. app-leftbar--expanded> <out.png> [width] [height] [light]
//   node e2e/tools/shot.mjs url   <url> <out.png> [width] [height]
//   node e2e/tools/shot.mjs all   <out dir> [light]
// A leaf is rendered at its own size (design/leaves/<id>.html). Stories need `npm run storybook` (port 6006).
//
// `all` is the regression check of a change that should not change any pixel (a CSS refactor): it writes every
// leaf (`<dir>/<theme>/leaves/<id>.png`, at its own size) and every story (`<dir>/<theme>/stories/<id>.png`,
// 1280x800; skipped when Storybook does not run), each with `.styles.txt`, a hash of the computed style of every
// element, which also shows changes that draw nothing (cursor, pointer-events). Animations are off (reduced
// motion). The theme is dark, with `light` light (leaves with a fixed theme are left out). Run it before and after
// the change into two directories and compare them with `diff -rq <before> <after>`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const [kind, id, out, ...rest] = process.argv.slice(2);
if (kind === "all") {
  if (!id) throw new Error("usage: shot.mjs all <out dir> [light]");
  await all(id, out === "light" || rest.includes("light"));
  process.exit(0);
}
if (!kind || !id || !out) throw new Error("usage: shot.mjs leaf|story|url <id> <out.png> [width] [height] [light] | all <out dir> [light]");
const light = rest.includes("light");
const [w, h] = rest.filter((a) => a !== "light").map(Number);

let url = id;
let size = { width: w || 1280, height: h || 800 };
if (kind === "leaf") {
  const { LEAVES } = await import(pathToFileURL(join(root, "design/src/leaves.mjs")).href);
  const leaf = LEAVES.find((l) => l.id === id);
  if (!leaf) throw new Error(`unknown leaf ${id}; known: ${LEAVES.map((l) => l.id).join(" ")}`);
  size = { width: leaf.w, height: leaf.h };
  url = `${pathToFileURL(join(root, "design/leaves", `${id}.html`)).href}${light ? "#theme=light" : ""}`;
  void readFileSync(join(root, "design/leaves", `${id}.html`));
} else if (kind === "story") {
  url = storyUrl(id, light);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: size });
page.on("pageerror", (e) => console.error("page error:", e.message));
page.on("console", (m) => m.type() === "error" && console.error("console error:", m.text()));
await page.goto(url, { waitUntil: "load" });
if (kind === "story") await page.waitForSelector("#storybook-root > *", { timeout: 15000 }).catch(() => console.error("the story rendered nothing"));
await page.waitForTimeout(400);
await page.screenshot({ path: out });
await browser.close();
console.log(`${out} ${size.width}x${size.height}`);

function storyUrl(storyId, lightTheme) {
  return `http://localhost:6006/iframe.html?id=${storyId}&viewMode=story&globals=theme:${lightTheme ? "light" : "dark"}`;
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
  const { LEAVES } = await import(pathToFileURL(join(root, "design/src/leaves.mjs")).href);
  dir = join(dir, lightTheme ? "light" : "dark"); // both themes can go into the same directory
  const shots = LEAVES.filter((l) => !(lightTheme && l.theme)).map((l) => ({
    file: join(dir, "leaves", l.id),
    url: `${pathToFileURL(join(root, "design/leaves", `${l.id}.html`)).href}#theme=${l.theme ?? (lightTheme ? "light" : "dark")}`,
    size: { width: l.w, height: l.h },
  }));
  let stories = [];
  try {
    const index = await (await fetch("http://localhost:6006/index.json")).json();
    stories = Object.values(index.entries).filter((e) => e.type === "story").map((e) => e.id);
  } catch {
    console.error("Storybook does not run on port 6006: only the leaves");
  }
  for (const s of stories) shots.push({ file: join(dir, "stories", s), url: storyUrl(s, lightTheme), size: { width: 1280, height: 800 }, story: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ reducedMotion: "reduce" });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  for (const shot of shots) {
    await page.setViewportSize(shot.size);
    await page.goto(shot.url, { waitUntil: "load" });
    if (shot.story) await page.waitForSelector("#storybook-root > *", { timeout: 15000 }).catch(() => console.error(`${shot.file}: the story rendered nothing`));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(shot.story ? 300 : 50);
    mkdirSync(dirname(shot.file), { recursive: true });
    await page.screenshot({ path: `${shot.file}.png`, animations: "disabled" });
    writeFileSync(`${shot.file}.styles.txt`, await page.evaluate(styleFingerprint));
  }
  await browser.close();
  console.log(`${dir}: ${shots.length - stories.length} leaves, ${stories.length} stories (${lightTheme ? "light" : "dark"})`);
}
